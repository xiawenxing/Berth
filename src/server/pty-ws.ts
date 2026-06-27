import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { berthHome } from '../paths'
import { join } from 'node:path'
import { getCache, getStore, refresh } from './store-singleton'
import { launchFresh } from '../pty/launch'
import { resolveAgentBinary, codexHookTrustSupportCached } from '../pty/binaries'
import { hasLivePty, liveDriverMode, registerPty, registerSession, attachViewer, killPty, broadcastControl } from './pty-registry'
import { bootGraceHold, COCO_BOOT_HOLD_MS, watchCodexFirstTurn } from './launch-ready'
import { parsePtyReplayBytes } from './pty-spool'
import { makeFreshStreamDriver } from './stream-driver-factory'
import { spawnAndRegister, spawnAndRegisterStream, codexHoldRunning } from './resume-spawn'
import { markOpened } from './warm-pool'
import { buildManifest, type ManifestInput } from '../agent/manifest'
import { listTasks, updateTask } from '../data/tasks'
import { listProjects } from '../data/projects'
import { getTaskFieldConfig, resolveStatusRoles, type TaskFieldConfig } from '../data/task-config'
import { getAgentConfig, resolveBerthAgent } from '../data/agent-config'
import { getDocsRoot, getDocStore } from '../data/docstore'
import { getContextConfig } from '../data/context-config'
import { seedDefaultProtocol, resolveProtocol } from '../data/context-protocol'
import { ensureContextDoc, maintainContextDocOnDiskAsync } from '../data/context-doc'
import { summarizeCompactedContext } from '../agent/context-compact'
import { getLocale, promptStrings, DEFAULT_LOCALE, type Locale } from '../i18n'
import { logDiag } from './diag'
import { shouldArmFirstTurnNudge, armFirstTurnNudge } from './launch-firstturn'
import type { Task } from '../data/types'
import type { AgentCli, LaunchIntent, LogicalSession } from '../types'

export { resolveStatusRoles } from '../data/task-config'

type Store = ReturnType<typeof getStore>
const INJECT_DIR = join(berthHome(), 'inject')
const FRESH_LAUNCH_DEDUPE_TTL_MS = 60_000

interface FreshLaunchResult {
  launchKey: string
  bound: boolean
  cli: AgentCli
  cwd: string
  mode: 'tui' | 'stream'
}

/** Model B (stream-json chat renderer) is opt-in via ?render=stream-json. All three CLIs support it:
 *  claude = persistent stream-json; codex/coco = per-turn spawn. */
function rendersStream(url: URL, cli: AgentCli | null | undefined): boolean {
  return url.searchParams.get('render') === 'stream-json' && (cli === 'claude' || cli === 'codex' || cli === 'coco')
}

const freshLaunchDedupe = new Map<string, Promise<FreshLaunchResult>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function rememberFreshLaunch(token: string, promise: Promise<FreshLaunchResult>) {
  freshLaunchDedupe.set(token, promise)
  promise
    .then(() => {
      const t = setTimeout(() => {
        if (freshLaunchDedupe.get(token) === promise) freshLaunchDedupe.delete(token)
      }, FRESH_LAUNCH_DEDUPE_TTL_MS)
      t.unref?.()
    })
    .catch(() => {
      if (freshLaunchDedupe.get(token) === promise) freshLaunchDedupe.delete(token)
    })
}

function sendLaunchFrame(ws: WebSocket, r: FreshLaunchResult) {
  try { ws.send(JSON.stringify({ __berth: 'launched', sessionId: r.launchKey, bound: r.bound, cli: r.cli, cwd: r.cwd, mode: r.mode })) } catch {}
}

export interface FreshLaunchParams {
  cli: AgentCli
  cwd: string
  todoKey: string | null
  projectId: string | null
  projectName?: string | null
}

export interface FreshLaunchPlan {
  sessionId: string | null
  intent: LaunchIntent
  bindNow: { sessionId: string; todoKey: string | null; projectId: string | null } | null
  manifestInput: ManifestInput
  // Default first user message for task-bound launches: turns the manifest (context only) into
  // actual work so the agent starts processing the task instead of sitting idle. null for
  // project/plain launches (the user drives those) and when the todoKey resolves to no todo.
  initialPrompt: string | null
}

/**
 * A directive first turn so a task-launched agent actually starts working (not just loads context).
 * Intentionally minimal: it just names the task title. The detail-doc path and the
 * maintenance/finish rules are delivered implicitly via the manifest (claude system prompt /
 * codex+coco context hook), so we don't repeat them in the prompt the user sees in the terminal.
 */
export function buildTaskInitialPrompt(todo: Task, locale: Locale = DEFAULT_LOCALE): string {
  return promptStrings(locale).start(todo.title)
}

export function composeLaunchInitialPrompt(
  plannedPrompt: string | null | undefined,
  explicitPrompt: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | undefined {
  const planned = plannedPrompt?.trim()
  const explicit = explicitPrompt?.trim()
  if (planned && explicit) {
    const label = locale === 'en' ? 'Additional notes for this session:' : '本次会话补充说明：'
    return `${planned}\n\n${label}\n${explicit}`
  }
  return explicit || planned || undefined
}

/**
 * Pure, testable launch decision: what session id (if any) to pre-mint, what intent/edge/attach
 * to record, and what manifest input to build. claude/coco pre-mint via `--session-id` (bound
 * immediately); codex has no `--session-id` and is bound later by reconcile-on-refresh.
 */
export function planFreshLaunch(
  params: FreshLaunchParams,
  todos: Task[],
  nowSec: number,
  mintId: () => string,
  docsRoot: string,
  locale: Locale = DEFAULT_LOCALE,
): FreshLaunchPlan {
  const { cli, cwd, todoKey, projectId } = params
  const deterministic = cli === 'claude' || cli === 'coco'
  const sessionId = deterministic ? mintId() : null
  // intent.id is the inject filename key: the minted sessionId for claude/coco (so it matches the
  // session), or a fresh uuid for codex (whose sessionId is unknown until reconcile).
  const intentId = deterministic ? sessionId! : mintId()

  const intent: LaunchIntent = {
    id: intentId,
    cli,
    cwd,
    projectId,
    todoKey,
    sessionId,
    createdAt: nowSec,
    bound: deterministic,
  }

  const bindNow = deterministic
    ? { sessionId: sessionId!, todoKey, projectId }
    : null

  const manifestInput = buildManifestInput(params, todos, docsRoot)

  // Synthesize a first turn only for a task that actually resolves to a todo. The detail doc itself
  // is surfaced to the agent through the manifest, not the prompt.
  const todo = todoKey ? todos.find(t => t.id === todoKey) : undefined
  const initialPrompt = todo ? buildTaskInitialPrompt(todo, locale) : null

  return { sessionId, intent, bindNow, manifestInput, initialPrompt }
}


/**
 * A task launch should move only genuinely pending tasks forward. This is intentionally a
 * one-shot transition at launch time: if the user later edits the task back to the pending status,
 * nothing here re-enforces in-progress until another explicit task launch happens.
 */
export function shouldAdvanceTodoOnLaunch(todo: Task | null | undefined, pendingStatus: string): todo is Task {
  return !!todo && todo.status === pendingStatus
}

export async function advanceTodoOnLaunch(store: Store, todo: Task | null | undefined): Promise<boolean> {
  const { pending, inProgress } = resolveStatusRoles(getTaskFieldConfig(store))
  if (!inProgress || !shouldAdvanceTodoOnLaunch(todo, pending)) return false
  // Updates the canonical store (sets the task dirty); a later sync pushes the new status to external sources.
  updateTask(store, todo.id, { status: inProgress })
  // Keep the launch-time snapshot consistent for the manifest/client refresh path.
  todo.status = inProgress
  return true
}

/** Build the manifest input: a task index when todoKey is set, else a project index. */
function buildManifestInput(params: FreshLaunchParams, todos: Task[], docsRoot: string): ManifestInput {
  const { todoKey, projectId } = params
  const explicitProjectName = params.projectName || null
  if (todoKey) {
    const todo = todos.find(t => t.id === todoKey)
    if (todo) {
      return {
        kind: 'task',
        projectName: todo.project ?? explicitProjectName ?? projectId ?? '—',
        projectId: todo.projectId ?? projectId,
        docsRoot,
        todo,
      }
    }
  }
  const projectName = projectId
    ? (explicitProjectName ?? todos.find(t => t.projectId === projectId || t.project === projectId)?.project ?? projectId)
    : '—'
  const projectTodos = projectId
    ? todos.filter(t => t.projectId === projectId || t.project === projectId).map(t => ({ title: t.title, detailDoc: t.detailDoc }))
    : []
  return {
    kind: 'project',
    projectName,
    projectId,
    docsRoot,
    projectTodos,
  }
}

export interface ContextInjection {
  compactRules: string[]
  protocolPath: string | null
  contextDocPath: string | null
}

/** Merge resolved context paths/rules into a manifest input. Pure; null = protocol disabled (no-op). */
export function enrichManifestForContext(input: ManifestInput, ctx: ContextInjection | null): ManifestInput {
  if (!ctx) return input
  return { ...input, compactRules: ctx.compactRules, protocolPath: ctx.protocolPath, contextDocPath: ctx.contextDocPath }
}

/** Per-launch context gates. Absent param = on, so old clients keep the always-on behavior. */
export function parseContextGates(p: URLSearchParams): { project: boolean; task: boolean } {
  const on = (k: string) => p.get(k) !== '0'
  return { project: on('ctxProject'), task: on('ctxTask') }
}

/** Drop any requested --add-dir that isn't a currently-enabled registered path (anti-arbitrary-mount). */
export function validateAddDirs(requested: string[], enabledPaths: string[]): string[] {
  const allow = new Set(enabledPaths)
  return requested.filter((d) => allow.has(d))
}

/**
 * Build the /pty WebSocketServer that bridges a CLI session into the browser. Returned in `noServer`
 * mode — the single upgrade router in index.ts dispatches '/pty' upgrades here (so /pty and /status
 * can share one http.Server; `{ server, path }` instances would 400 each other's upgrades).
 */
export function createPtyWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const cols = Number(url.searchParams.get('cols')) || 120
    const rows = Number(url.searchParams.get('rows')) || 30
    const replayBytes = parsePtyReplayBytes(url.searchParams.get('historyBytes'))

    if (url.searchParams.get('new') === '1') {
      handleFresh(ws, url, cols, rows).catch(e => {
        try { ws.send(`\r\n[berth] launch failed: ${e?.message}\r\n`) } catch {}
        try { ws.close() } catch {}
      })
      return
    }

    // resume branch — attach to a live process if one is already running (in the SAME render mode),
    // else spawn `--resume`. A mode mismatch (the A/B toggle) kills the live process and respawns in
    // the requested mode, so a chat renderer never attaches to a raw-bytes TUI driver or vice versa.
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) { try { ws.send('\r\n[berth] no sessionId\r\n') } catch {} ; ws.close(); return }
    const s = getCache().find(x => x.sessionId === sessionId)
    const wantStream = rendersStream(url, s?.cli)
    if (hasLivePty(sessionId)) {                  // already running (incl. a warm-pool pre-spawn)
      const liveMode = liveDriverMode(sessionId)
      // Reattach when the modes match. Also reattach (never kill) when the session isn't in the disk
      // cache yet: that's an in-flight launch (no jsonl written), whose render mode can't have been
      // toggled — killing it here would destroy the still-running agent and is exactly the
      // "reopen-loses-the-session" failure we're fixing. Only a known, cached session may A↔B respawn.
      if (liveMode === (wantStream ? 'stream' : 'tui') || !s) {
        markOpened(sessionId)                     // user opened it → graduate out of the warm pool
        logDiag({ category: 'resume', event: 'attach_live', sessionId, cli: s?.cli, mode: liveMode, inFlight: !s })
        attachViewer(sessionId, ws, { replayBytes }); return
      }
      logDiag({ category: 'resume', event: 'mode_switch_kill', sessionId, cli: s?.cli, from: liveMode })
      killPty(sessionId)                          // mode switch (A↔B) → respawn in the requested mode below
    }

    if (!s || !s.resume) { logDiag({ category: 'resume', event: 'not_resumable', sessionId, level: 'warn', cached: !!s }); try { ws.send('\r\n[berth] session not found or not resumable\r\n') } catch {} ; ws.close(); return }
    try {
      if (wantStream) spawnAndRegisterStream(s)                                 // Model B: stream-json resume (claude/codex/coco)
      else spawnAndRegister(s, { cols, rows })                                 // Model A: TUI resume
    } catch (e: any) { try { ws.send(`\r\n[berth] launch failed: ${e?.message}\r\n`) } catch {} ; ws.close(); return }
    attachViewer(sessionId, ws, { replayBytes })
  })
  return wss
}

/** Fresh-launch branch: mint id, build manifest, record intent/edge/attach, spawn, and bridge. */
async function handleFresh(ws: WebSocket, url: URL, cols: number, rows: number) {
  const cli = url.searchParams.get('cli') as AgentCli | null
  const launchToken = url.searchParams.get('launchToken') || null
  const todoKey = url.searchParams.get('todoKey') || null
  const projectId = url.searchParams.get('projectId') || null
  const explicitPrompt = url.searchParams.get('prompt') || undefined
  const gates = parseContextGates(url.searchParams)
  const requestedAddDirs = url.searchParams.getAll('addDirs')

  if (cli !== 'claude' && cli !== 'codex' && cli !== 'coco') {
    try { ws.send(`\r\n[berth] unknown cli\r\n`) } catch {} ; ws.close(); return
  }
  // cwd resolution: an explicit cwd wins; otherwise (no enabled 货舱) fall back to the project's
  // Berth-assigned workspace dir (~/.berth/workspaces/<id>, created on demand by ensureLaunchCwd).
  // Only a launch with neither cwd nor project has nowhere to go → reject.
  let cwd = url.searchParams.get('cwd') || ''
  if (!cwd && projectId) cwd = join(berthHome(), 'workspaces', projectId)
  if (!cwd) {
    try { ws.send(`\r\n[berth] missing cwd\r\n`) } catch {} ; ws.close(); return
  }
  const isWorkspaceCwd = projectId != null && cwd === join(berthHome(), 'workspaces', projectId)

  const store = getStore()
  // NB: keyed strictly by project id (not name); LaunchDialog always passes a real projectId.
  const enabledPaths = projectId
    ? (store.allProjectPaths().get(projectId)?.meta.filter((m) => m.enabled).map((m) => m.cwd) ?? [])
    : []
  const userAddDirs = validateAddDirs(requestedAddDirs, enabledPaths)
  if (requestedAddDirs.length > userAddDirs.length) {
    try { ws.send(`\r\n[berth] ignored ${requestedAddDirs.length - userAddDirs.length} unregistered --add-dir path(s)\r\n`) } catch {}
  }
  const anyCtx = gates.project || gates.task
  // The launching CLI must be a currently-enabled agent (Settings → Agents).
  const agentCfg = getAgentConfig(store)
  const agentEntry = agentCfg.list.find(a => a.cli === cli)
  if (!agentEntry?.enabled) {
    try { ws.send(`\r\n[berth] agent "${cli}" is disabled\r\n`) } catch {} ; ws.close(); return
  }

  const wantStreamLog = rendersStream(url, cli)
  logDiag({
    category: 'launch', event: 'fresh_start', launchToken: launchToken ?? undefined, cli, cwd,
    todoKey: todoKey ?? undefined, projectId: projectId ?? undefined,
    hasPrompt: !!explicitPrompt, mode: wantStreamLog ? 'stream' : 'tui',
  })

  if (launchToken) {
    const existing = freshLaunchDedupe.get(launchToken)
    if (existing) {
      try {
        const result = await existing
        logDiag({ category: 'launch', event: 'dedup_hit', launchToken, sessionId: result.launchKey, cli, mode: result.mode })
        sendLaunchFrame(ws, result)
        if (!attachViewer(result.launchKey, ws, { replayBytes: parsePtyReplayBytes(url.searchParams.get('historyBytes')) })) {
          logDiag({ category: 'launch', event: 'dedup_pty_gone', launchToken, sessionId: result.launchKey, level: 'warn' })
          try { ws.send('\r\n[berth] launch exists but live pty is gone\r\n') } catch {}
          ws.close()
        }
      } catch (e: any) {
        try { ws.send(`\r\n[berth] launch failed: ${e?.message ?? e}\r\n`) } catch {}
        ws.close()
      }
      return
    }
  }

  let launchDeferred: ReturnType<typeof deferred<FreshLaunchResult>> | null = null
  if (launchToken) {
    launchDeferred = deferred<FreshLaunchResult>()
    rememberFreshLaunch(launchToken, launchDeferred.promise)
  }

  try {
  const locale = getLocale(store)
  // Tasks are read from the canonical internal store (instant; no external latency).
  const docsRoot = getDocsRoot(store)
  const todos = listTasks(store)
  const projectName = projectId ? listProjects(store).find(p => p.id === projectId || p.name === projectId)?.name ?? null : null
  const launchedTodo = todoKey ? todos.find(t => t.id === todoKey) : undefined
  try {
    await advanceTodoOnLaunch(store, launchedTodo)
  } catch (e: any) {
    try { ws.send(`\r\n[berth] task status update skipped: ${e?.message ?? e}\r\n`) } catch {}
  }
  const plan = planFreshLaunch({ cli, cwd, todoKey, projectId, projectName }, todos, Math.floor(Date.now() / 1000), () => randomUUID(), docsRoot, locale)

  // Context maintenance: seed the protocol, ensure this entity's context file, and inject the
  // compact rules + paths through the same silent manifest channel. Also remember the context-file
  // abs path so the PTY-exit mechanical rotation (§7 Phase 1) can roll its progress log.
  // Every CLI now receives the manifest through a silent channel — claude via
  // `--append-system-prompt-file`, codex + coco via a SessionStart hook keyed on $BERTH_CONTEXT_FILE
  // (launchFresh sets the env var per CLI). The manifest never rides in the positional prompt, so the
  // agent loads its context whether or not there is a first turn to submit. The whole build is gated
  // on at least one context gate being on — both off → no inject file, no docsRoot, no env hook.
  let contextAbs: string | null = null
  let injectFile: string | undefined
  let ctxAddDirs: string[] = []
  const ctxCfg = getContextConfig(store)
  if (anyCtx) {
    let ctxInjection: ContextInjection | null = null
    if (ctxCfg.protocolEnabled) {
      try {
        const ds = getDocStore(store)
        seedDefaultProtocol(ds, locale)
        const projectName = plan.manifestInput.projectName
        const proto = resolveProtocol(ds, locale, projectName)
        let ensuredAbs: string | null = null
        if (todoKey && launchedTodo) {
          const ensured = ensureContextDoc(ds, 'task', launchedTodo.id, { title: launchedTodo.title, projectName: launchedTodo.project, locale })
          ensuredAbs = ensured.abs
          if (ensured.created && !launchedTodo.detailDoc) {
            store.updateTaskFields(launchedTodo.id, { detailDoc: ensured.ref }, Date.now())
            launchedTodo.detailDoc = ensured.ref
          }
        } else if (projectId && projectName && projectName !== '—') {
          const ensured = ensureContextDoc(ds, 'project', projectName, { title: projectName, projectName, locale })
          ensuredAbs = ensured.abs
        }
        contextAbs = ensuredAbs
        ctxInjection = { compactRules: proto.compactRules, protocolPath: proto.protocolPath, contextDocPath: ensuredAbs }
      } catch (e: any) {
        // docsRoot unwritable etc. → inject read-only context, skip maintenance, never block launch (§10).
        try { ws.send(`\r\n[berth] context init skipped: ${e?.message ?? e}\r\n`) } catch {}
      }
    }
    const enriched = { ...enrichManifestForContext(plan.manifestInput, ctxInjection), include: { project: gates.project, task: gates.task } }
    const { text, addDirs } = buildManifest(enriched, locale)
    mkdirSync(INJECT_DIR, { recursive: true })
    const injectFilePath = join(INJECT_DIR, `${plan.intent.id}.txt`)
    writeFileSync(injectFilePath, text)
    injectFile = injectFilePath
    ctxAddDirs = addDirs // [docsRoot] — bound to "any context on"; hidden from the user
  }
  const finalAddDirs = [...userAddDirs, ...ctxAddDirs]

  store.addLaunchIntent(plan.intent)
  if (plan.bindNow) {
    if (plan.bindNow.todoKey) store.addEdge(plan.bindNow.todoKey, plan.bindNow.sessionId)
    // Only attach to a REAL project. A project-less launch must not write a null-project attach:
    // that marker has no consumer (the frontend never reads attachState) but used to curate the
    // session, force-keeping it under a phantom "(NO CWD)" group during the CLI's init window. The
    // session surfaces via allBoundLaunchSessionIds() → curated (addLaunchIntent here writes the
    // bound row for claude/coco; codex surfaces once reconcile binds it) — NOT via its cwd anymore.
    if (plan.bindNow.projectId) store.setAttach(plan.bindNow.sessionId, plan.bindNow.projectId, 'confirmed')
  }

  // For task launches, an explicit ?prompt= is a per-session supplement to the default task
  // directive, not a replacement. Project/free launches have no planned prompt, so explicit text
  // remains the whole first turn.
  const initialPrompt = composeLaunchInitialPrompt(plan.initialPrompt, explicitPrompt, locale)

  // codex injects context via a SessionStart hook gated on `--dangerously-bypass-hook-trust`. The
  // support probe is warmed off the launch path; read only the cache here so a warning never blocks
  // the user's click-to-spawn path.
  if (cli === 'codex' && injectFile) {
    try {
      const support = codexHookTrustSupportCached(resolveAgentBinary('codex'))
      if (support === false)
        ws.send(`\r\n[berth] codex is too old for context injection (no --dangerously-bypass-hook-trust); started without it. Upgrade codex to auto-load project/task context.\r\n`)
      else if (support === undefined)
        ws.send(`\r\n[berth] codex context probe is still warming; started immediately without auto-loaded project/task context. Future launches will use it once the probe completes.\r\n`)
    } catch {}
  }

  // Remember this project's last real launch cwd (sticky 主 cwd for the launch dialog's auto-pick).
  // Skip the workspace fallback — it's the catch-all, not a user choice.
  if (projectId && !isWorkspaceCwd) {
    try { store.setSetting(`project_last_cwd:${projectId}`, cwd) } catch {}
  }

  // Register under the session key (claude/coco minted id; codex uses its intent id and is
  // rekeyed to the real id by reconcile). The process now persists across viewer disconnects.
  // A launch with an auto-fired prompt is a turn in progress → show the spinner immediately;
  // a plain empty session is idle until the user types.
  const launchKey = plan.sessionId ?? plan.intent.id
  const onExit = contextAbs ? () => {
    void maintainContextDocOnDiskAsync(
      getDocStore(store), contextAbs!, { ...ctxCfg, locale },
      (input) => summarizeCompactedContext(input, resolveBerthAgent(store)),
    ).catch(() => {})
  } : undefined

  const wantStream = rendersStream(url, cli)
  if (wantStream) {
    // Model B: no positional prompt — the driver delivers the first user turn (claude via stdin NDJSON;
    // codex/coco as the per-turn exec prompt). claude's manifest rides --append-system-prompt-file
    // (injectFile); codex/coco Model B v1 doesn't inject the manifest yet (per-turn hook is a follow-up).
    const driver = makeFreshStreamDriver(cli, {
      cwd,
      sessionId: plan.sessionId ?? undefined,
      injectFile,
      model: agentEntry.model ?? undefined,
      addDirs: finalAddDirs,
      initialPrompt,
    })
    // holdRunning keeps the session `running` through the agent's silent thinking gap (no output for
    // >IDLE_MS) so a freshly-launched chat turn never falsely settles to 停泊 mid-turn.
    registerSession(launchKey, driver, { running: !!initialPrompt, holdRunning: () => driver.turnActive?.() ?? false, onExit })
  } else {
    // The first turn is delivered as the CLI's NATIVE positional `[PROMPT]` for ALL three CLIs: the CLI
    // queues it and auto-submits once ITS OWN composer is ready, delegating timing to the authority on
    // it. This is the most reliable Model-A option (PTY-probed): far better than the reverted
    // readiness-gated typed paste (autoSubmitWhenReady), which typed at the bracketed-paste marker —
    // emitted during the banner, claude ~0.4s in, long before the composer accepts input — so the turn
    // landed in a not-yet-ready screen and was dropped (the "概率性 query 不自动发送" bug). claude's trust
    // dialog (gotcha #11), the original reason its positional sometimes vanished, is pre-seeded in
    // pty/trust.ts so the positional reaches it. CAVEAT: claude's interactive auto-submit still has a
    // rare slow-startup miss (probe: ~3/4); the only race-free delivery is Model B (stream-json, turn
    // via stdin) — see gotcha #15.
    const freshOpts = {
      cwd,
      sessionId: plan.sessionId ?? undefined,
      injectFile,
      callbackToken: cli === 'codex' ? plan.intent.id : undefined,  // channel A: token = intent id
      initialPrompt: initialPrompt ?? undefined,
      model: agentEntry.model ?? undefined,   // per-CLI default model (claude/codex; coco ignores)
      addDirs: finalAddDirs,
      cols,
      rows,
    }
    const pty = launchFresh(cli, freshOpts)
    registerPty(launchKey, pty, {
      running: !!initialPrompt,
      // codex polls its rollout turn-state; coco has no such file, so a boot-grace guard stops the
      // activity FSM from a false 已停泊 during coco's boot gap (see launch-ready.ts).
      holdRunning: cli === 'codex' ? codexHoldRunning(initialPrompt ? 'running' : 'unknown')
        : cli === 'coco' && initialPrompt ? bootGraceHold(COCO_BOOT_HOLD_MS)
        : undefined,
      onExit,
      // Reactive last resort: if the fresh pty fast-fails (a flag this build rejects that proactive
      // gating didn't catch), the driver re-spawns once with the minimal/most-compatible arg set.
      respawn: () => { try { return launchFresh(cli, freshOpts, { minimal: true }) } catch { return null } },
    })
    // codex's deterministic "first turn started" signal (rollout task_started) is the precise moment
    // to drop the launch mask — far better than the boot-output quiet heuristic, which codex's
    // mid-boot confirmation / MCP-startup pauses fool. Watch for it and push a {turnStarted} frame.
    if (cli === 'codex' && initialPrompt) {
      const intentId = plan.intent.id
      watchCodexFirstTurn({
        refresh,
        boundSessionId: () => getStore().boundSessionForIntent(intentId),
        pathFor: (sid) => getCache().find(s => s.sessionId === sid)?.contentSourcePath ?? null,
        alive: (sid) => hasLivePty(sid),
        emit: (sid) => broadcastControl(sid, { __berth: 'turnStarted', sessionId: sid }),
      })
    }
    // claude/coco: nudge the pre-filled positional prompt's Enter if the composer's slow-cold-start
    // auto-submit missed it (gotcha #15). Guarded against double-submit by the surfaced() check —
    // skips the instant a jsonl exists (a turn already ran). See launch-firstturn.ts.
    if (shouldArmFirstTurnNudge({ cli, mode: 'tui', hasInitialPrompt: !!initialPrompt })) {
      logDiag({ category: 'firstturn', event: 'nudge_armed', sessionId: launchKey, cli })
      armFirstTurnNudge({
        alive: () => hasLivePty(launchKey),
        surfaced: () => { refresh(); return !!getCache().find(s => s.sessionId === launchKey) },
        sendEnter: () => { try { pty.write('\r') } catch {} },
        onAttempt: (fired, i) => { if (fired) logDiag({ category: 'firstturn', event: 'nudge_fired', sessionId: launchKey, cli, attempt: i }) },
      })
    }
  }
  // Tell the client which session id this fresh launch maps to, so it can bind the drawer to the
  // live registry key. This MUST be after register*: 2.0 re-opens /pty?sessionId=… immediately on
  // this frame, and sending it earlier races the registry and can attach the UI to stale transcript
  // state instead of the just-launched process.
  const launchResult: FreshLaunchResult = { launchKey, bound: !!plan.sessionId, cli, cwd, mode: wantStream ? 'stream' : 'tui' }
  logDiag({
    category: 'launch', event: 'spawned', launchToken: launchToken ?? undefined, sessionId: launchKey, cli,
    bound: launchResult.bound, mode: launchResult.mode, hasInitialPrompt: !!initialPrompt,
  })
  launchDeferred?.resolve(launchResult)
  sendLaunchFrame(ws, launchResult)
  logDiag({ category: 'launch', event: 'launched_frame', launchToken: launchToken ?? undefined, sessionId: launchKey, cli })
  attachViewer(launchKey, ws, { replayBytes: parsePtyReplayBytes(url.searchParams.get('historyBytes')) })
  } catch (e) {
    logDiag({ category: 'launch', event: 'error', launchToken: launchToken ?? undefined, cli, level: 'error', message: String((e as any)?.message ?? e) })
    launchDeferred?.reject(e)
    throw e
  }
}
