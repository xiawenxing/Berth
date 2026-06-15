import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { berthHome } from '../paths'
import { join } from 'node:path'
import { getCache, getStore } from './store-singleton'
import { resumeSession, launchFresh } from '../pty/launch'
import { hasLivePty, registerPty, attachViewer } from './pty-registry'
import { buildManifest, type ManifestInput } from '../agent/manifest'
import { listTasks, updateTask } from '../data/tasks'
import { getTaskFieldConfig, type TaskFieldConfig } from '../data/task-config'
import { getAgentConfig } from '../data/agent-config'
import { getDocsRoot, getDocStore } from '../data/docstore'
import { getContextConfig } from '../data/context-config'
import { seedDefaultProtocol, resolveProtocol } from '../data/context-protocol'
import { ensureContextDoc, rotateContextDocOnDisk } from '../data/context-doc'
import { getLocale, promptStrings, DEFAULT_LOCALE, type Locale } from '../i18n'
import { latestCodexTurnState, type CodexTurnState } from '../adapters/codex-turn'
import type { Task } from '../data/types'
import type { AgentCli, LaunchIntent } from '../types'

type Store = ReturnType<typeof getStore>
const INJECT_DIR = join(berthHome(), 'inject')

export interface FreshLaunchParams {
  cli: AgentCli
  cwd: string
  todoKey: string | null
  projectId: string | null
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

function codexHoldRunning(initialState: CodexTurnState = 'unknown') {
  let lastState = initialState
  return (sessionId: string): boolean => {
    const s = getCache().find(x => x.sessionId === sessionId)
    const next = s?.contentSourcePath ? latestCodexTurnState(s.contentSourcePath) : 'unknown'
    if (next !== 'unknown') lastState = next
    return lastState === 'running'
  }
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
 * Resolve the "pending"/"in-progress" status roles from the configured vocabulary, by position:
 * pending = the default (new-task) status; in-progress = the status right after it in the list.
 * This keeps launch auto-advance working for ANY vocabulary (zh-CN 待办→进行中, English Todo→In
 * Progress, …) instead of hard-comparing literal Chinese values. Returns inProgress=null when there
 * is no "next" status (single-status list), in which case nothing advances.
 */
export function resolveStatusRoles(cfg: TaskFieldConfig): { pending: string; inProgress: string | null } {
  const pending = cfg.defaultStatus
  const idx = cfg.statuses.indexOf(pending)
  const inProgress = idx >= 0 && idx + 1 < cfg.statuses.length ? cfg.statuses[idx + 1] : null
  return { pending, inProgress }
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
  if (todoKey) {
    const todo = todos.find(t => t.id === todoKey)
    if (todo) {
      return {
        kind: 'task',
        projectName: todo.project ?? projectId ?? '—',
        docsRoot,
        todo,
      }
    }
  }
  const projectName = projectId
    ? (todos.find(t => t.projectId === projectId || t.project === projectId)?.project ?? projectId)
    : '—'
  const projectTodos = projectId
    ? todos.filter(t => t.projectId === projectId || t.project === projectId).map(t => ({ title: t.title, detailDoc: t.detailDoc }))
    : []
  return {
    kind: 'project',
    projectName,
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

    if (url.searchParams.get('new') === '1') {
      handleFresh(ws, url, cols, rows).catch(e => {
        try { ws.send(`\r\n[berth] launch failed: ${e?.message}\r\n`) } catch {}
        try { ws.close() } catch {}
      })
      return
    }

    // resume branch — attach to a live pty if one is already running, else spawn `--resume`
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) { try { ws.send('\r\n[berth] no sessionId\r\n') } catch {} ; ws.close(); return }
    if (hasLivePty(sessionId)) { attachViewer(sessionId, ws); return }   // already running → just view it

    const s = getCache().find(x => x.sessionId === sessionId)
    if (!s || !s.resume) { try { ws.send('\r\n[berth] session not found or not resumable\r\n') } catch {} ; ws.close(); return }
    let pty
    try {
      pty = resumeSession(s, { cols, rows })
    } catch (e: any) { try { ws.send(`\r\n[berth] launch failed: ${e?.message}\r\n`) } catch {} ; ws.close(); return }

    registerPty(sessionId, pty, {
      holdRunning: s.cli === 'codex' ? codexHoldRunning() : undefined,
    })
    attachViewer(sessionId, ws)
  })
  return wss
}

/** Fresh-launch branch: mint id, build manifest, record intent/edge/attach, spawn, and bridge. */
async function handleFresh(ws: WebSocket, url: URL, cols: number, rows: number) {
  const cli = url.searchParams.get('cli') as AgentCli | null
  const cwd = url.searchParams.get('cwd')
  const todoKey = url.searchParams.get('todoKey') || null
  const projectId = url.searchParams.get('projectId') || null
  const explicitPrompt = url.searchParams.get('prompt') || undefined

  if (cli !== 'claude' && cli !== 'codex' && cli !== 'coco') {
    try { ws.send(`\r\n[berth] unknown cli\r\n`) } catch {} ; ws.close(); return
  }
  if (!cwd) {
    try { ws.send(`\r\n[berth] missing cwd\r\n`) } catch {} ; ws.close(); return
  }

  const store = getStore()
  // The launching CLI must be a currently-enabled agent (Settings → Agents).
  const agentCfg = getAgentConfig(store)
  const agentEntry = agentCfg.list.find(a => a.cli === cli)
  if (!agentEntry?.enabled) {
    try { ws.send(`\r\n[berth] agent "${cli}" is disabled\r\n`) } catch {} ; ws.close(); return
  }
  const locale = getLocale(store)
  // Tasks are read from the canonical internal store (instant; no external latency).
  const docsRoot = getDocsRoot(store)
  const todos = listTasks(store)
  const launchedTodo = todoKey ? todos.find(t => t.id === todoKey) : undefined
  try {
    await advanceTodoOnLaunch(store, launchedTodo)
  } catch (e: any) {
    try { ws.send(`\r\n[berth] task status update skipped: ${e?.message ?? e}\r\n`) } catch {}
  }
  const plan = planFreshLaunch({ cli, cwd, todoKey, projectId }, todos, Math.floor(Date.now() / 1000), () => randomUUID(), docsRoot, locale)

  // Context maintenance: seed the protocol, ensure this entity's context file, and inject the
  // compact rules + paths through the same silent manifest channel. Also remember the context-file
  // abs path so the PTY-exit mechanical rotation (§7 Phase 1) can roll its progress log.
  let contextAbs: string | null = null
  let ctxInjection: ContextInjection | null = null
  const ctxCfg = getContextConfig(store)
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

  const enrichedManifest = enrichManifestForContext(plan.manifestInput, ctxInjection)
  const { text, addDirs } = buildManifest(enrichedManifest, locale)

  mkdirSync(INJECT_DIR, { recursive: true })
  const injectFilePath = join(INJECT_DIR, `${plan.intent.id}.txt`)
  writeFileSync(injectFilePath, text)

  // Every CLI now receives the manifest through a silent channel — claude via
  // `--append-system-prompt-file`, codex + coco via a SessionStart hook keyed on $BERTH_CONTEXT_FILE
  // (launchFresh sets the env var per CLI). The manifest never rides in the positional prompt, so the
  // agent loads its context whether or not there is a first turn to submit.
  const injectFile = injectFilePath

  store.addLaunchIntent(plan.intent)
  if (plan.bindNow) {
    if (plan.bindNow.todoKey) store.addEdge(plan.bindNow.todoKey, plan.bindNow.sessionId)
    // Only attach to a REAL project. A project-less launch must not write a null-project attach:
    // that marker has no consumer (the frontend never reads attachState) but used to curate the
    // session, force-keeping it under a phantom "(NO CWD)" group during the CLI's init window. The
    // session surfaces normally via its launch-intent cwd (an import root) once that cwd is known.
    if (plan.bindNow.projectId) store.setAttach(plan.bindNow.sessionId, plan.bindNow.projectId, 'confirmed')
  }

  // Tell the client which session id this fresh launch maps to, so it can associate its
  // "创建中…" placeholder row with the real session as soon as that session surfaces in the list.
  // claude/coco are bound now (deterministic id); codex sends its intent id with bound:false and the
  // client falls back to matching by cwd+cli. Sent before attachViewer so it precedes any pty output.
  const launchKey = plan.sessionId ?? plan.intent.id
  try { ws.send(JSON.stringify({ __berth: 'launched', sessionId: launchKey, bound: !!plan.sessionId, cli, cwd })) } catch {}

  // An explicit ?prompt= wins; otherwise a task launch auto-fires its directive so the agent
  // starts working (and, by taking a real turn, writes a transcript and surfaces in the list).
  const initialPrompt = explicitPrompt ?? plan.initialPrompt ?? undefined

  const pty = launchFresh(cli, {
    cwd,
    sessionId: plan.sessionId ?? undefined,
    injectFile,
    initialPrompt,
    model: agentEntry.model ?? undefined,   // per-CLI default model (claude/codex; coco ignores)
    addDirs,
    cols,
    rows,
  })

  // Register under the session key (claude/coco minted id; codex uses its intent id and is
  // rekeyed to the real id by reconcile). The pty now persists across viewer disconnects.
  // A launch with an auto-fired prompt is a turn in progress → show the spinner immediately;
  // a plain empty session is idle until the user types.
  registerPty(plan.sessionId ?? plan.intent.id, pty, {
    running: !!initialPrompt,
    holdRunning: cli === 'codex' ? codexHoldRunning(initialPrompt ? 'running' : 'unknown') : undefined,
    onExit: contextAbs ? () => {
      try { rotateContextDocOnDisk(getDocStore(store), contextAbs!, { maxLines: ctxCfg.logMaxLines, keep: ctxCfg.logKeep, locale }) } catch {}
    } : undefined,
  })
  attachViewer(plan.sessionId ?? plan.intent.id, ws)
}
