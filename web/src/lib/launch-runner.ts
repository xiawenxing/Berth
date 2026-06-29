import type { AgentCli, ApiProject, ApiSession } from './api'
import { shortCwd } from './format'
import { deriveLaunch, type CargoState } from './launch-cargo'
import { logDiag } from './diag'
import { firstTurnSteps, BRACKETED_PASTE_READY, type SubmitEmit } from './launch-firstturn-steps'

export interface LaunchImage {
  name: string
  dataUrl: string
}

export interface LaunchPending {
  tempId: string
  cli: string
  cwd: string
  cwdLabel: string
  projectId: string | null
  todoKey: string | null
  sessionId: string | null
  knownIds: string[]
  createdAt: number
}

export interface LaunchDrawerSession {
  title: string
  cli: string
  cwd: string
  status: 'sail' | 'dock' | 'moored'
  task?: string
  launch: {
    cli: string
    cwd: string
    launchToken: string
    projectId?: string | null
    todoKey?: string | null
    prompt?: string
    images?: LaunchImage[]
    addDirs?: string[]
    ctxProject?: boolean
    ctxTask?: boolean
  }
}

export interface StartFreshLaunchInput {
  dest: 'task' | 'free'
  title: string
  cli: AgentCli
  cargo: CargoState | null
  sessions: ApiSession[]
  addPending: (p: LaunchPending) => void
  resolvePending?: (tempId: string, sessionId: string) => void
  resync?: () => Promise<void> | void
  openDrawer: (s: LaunchDrawerSession) => void
  project?: ApiProject
  projectId?: string | null
  todoKey?: string | null
  taskTitle?: string
  taskNote?: string
  freeText?: string
  images?: LaunchImage[]
  makeLaunchToken?: () => string
  now?: () => number
}

function streamRenderEnabled(): boolean {
  try { return localStorage.getItem('berth-render-mode') === 'B' } catch { return false }
}

/** The fields of a launch spec the first-turn routing depends on (shared by LaunchDrawerSession and
 *  the drawer terminal's LaunchSpec). */
export interface FirstTurnLaunch {
  cli: string
  prompt?: string
  images?: { name: string; dataUrl: string }[]
  todoKey?: string | null
}

// Model A only: claude/coco FREE launches submit their first turn over the prime socket (gated on the
// CLI being ready), NOT via the CLI's native URL positional. The positional's cold-start auto-submit
// has a rare miss that strands the typed query pre-filled-but-unsent in the composer. codex keeps the
// positional (its submit is reliable); task launches keep it too so the user note composes with the
// task directive the server injects as the positional.
function wantsSocketTextSubmit(launch: FirstTurnLaunch): boolean {
  if (!launch.prompt?.trim()) return false
  if (launch.todoKey) return false
  return launch.cli === 'claude' || launch.cli === 'coco'
}

/** Whether this launch's first-turn prompt rides the URL positional (vs. being submitted over the
 *  prime socket once the CLI is ready). Shared with the drawer terminal so exactly one path submits. */
export function launchPromptRidesUrl(launch: FirstTurnLaunch, renderStream: boolean): boolean {
  if (!launch.prompt || launch.images?.length) return false // images can never ride a URL
  if (renderStream) return true                              // Model B delivers the URL prompt over stdin
  return !wantsSocketTextSubmit(launch)                      // Model A: claude/coco free → socket, else URL
}

function buildLaunchQuery(launch: LaunchDrawerSession['launch'], renderStream: boolean): URLSearchParams {
  const qs = new URLSearchParams({ new: '1', cli: launch.cli, cwd: launch.cwd, cols: '120', rows: '30' })
  if (renderStream) qs.set('render', 'stream-json')
  if (launch.launchToken) qs.set('launchToken', launch.launchToken)
  if (launch.projectId) qs.set('projectId', launch.projectId)
  if (launch.todoKey) qs.set('todoKey', launch.todoKey)
  if (launchPromptRidesUrl(launch, renderStream)) qs.set('prompt', launch.prompt!)
  if (launch.ctxProject === false) qs.set('ctxProject', '0')
  if (launch.ctxTask === false) qs.set('ctxTask', '0')
  for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
  return qs
}

const PRIME_PAYLOAD_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 120
// Legacy (codex / other non-claude-coco image launches) attach signals, kept for that path only.
const IMAGE_ATTACH_MARK = '[Image'
const IMAGE_ATTACH_FALLBACK_MS = 3_000

/**
 * A drawer-INDEPENDENT socket that drives a fresh launch to completion so closing the drawer
 * mid-creation can never drop the session or its first turn.
 *
 * - codex/task text launches: the prompt rides the URL positional, so the server fires the first turn
 *   at spawn. This socket only confirms the {launched} frame, then closes.
 * - claude/coco launches (text and/or image): this socket owns the first turn and submits it over the
 *   live PTY once the CLI is genuinely IDLE — gated on output going quiet after the bracketed-paste
 *   marker, NOT on the raw marker (which fires mid-boot, while the composer takes typed input but
 *   drops an Enter — verified live). See `firstTurnSteps`. Doing it here, off the drawer sockets
 *   (pure viewers), means exactly one socket submits and it survives the drawer being closed.
 */
function primeFreshLaunch(launch: LaunchDrawerSession['launch'], onLaunched?: (sessionId: string) => void | Promise<void>): void {
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
  const stream = streamRenderEnabled()
  const images = (launch.images ?? []).filter((img) => img.dataUrl)
  const hasImages = images.length > 0
  const prompt = launch.prompt?.trim() ?? ''
  const claudeOrCoco = launch.cli === 'claude' || launch.cli === 'coco'
  const socketText = !stream && !hasImages && wantsSocketTextSubmit(launch)
  // claude/coco own first-turn delivery over this socket, gated on the CLI being genuinely idle.
  const useStepper = !stream && claudeOrCoco && (hasImages || socketText)
  // Other CLIs' image launches keep their prior marker-based path (don't perturb codex on this branch).
  const legacyImage = !stream && hasImages && !claudeOrCoco

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/pty?${buildLaunchQuery(launch, stream).toString()}`)
  ws.binaryType = 'arraybuffer'
  const tok = launch.launchToken
  logDiag('connect', 'prime_open', { launchToken: tok, cli: launch.cli, hasImages, mode: stream ? 'stream' : 'tui' })
  ws.onclose = () => logDiag('connect', 'prime_close', { launchToken: tok, cli: launch.cli, sessionId: launchedId ?? undefined })
  let launchedId: string | null = null
  let recentOutput = ''
  let lastDataAt = 0
  let launchedAt = 0
  let done = false
  let poll: ReturnType<typeof setInterval> | undefined

  // First-turn delivery tracer. The idle-gated stepper drops paste/Enter SILENTLY when the socket is
  // already closed (emit() no-ops) or when the readiness heuristic misfires — and that's exactly the
  // intermittent "claude launched, title generated, but the query was never typed or sent" bug. Without
  // this trace each occurrence leaves no evidence. Correlated by launchToken/sessionId; never logs
  // prompt text (lengths only). Category 'firstturn' matches the server-side nudge events.
  const ftDiag = (event: string, extra: Record<string, unknown> = {}): void =>
    logDiag('firstturn', event, {
      launchToken: tok, cli: launch.cli, sessionId: launchedId ?? undefined,
      hasImages, hasPrompt: !!prompt, ...extra,
    })

  const stop = () => { if (poll) { clearInterval(poll); poll = undefined } }
  const closeSoon = () => setTimeout(() => { try { ws.close() } catch {} }, 100)
  // Image payloads can be multiple MB; close only once the send buffer has drained so a large paste
  // is never truncated by an eager close.
  const closeWhenFlushed = () => {
    const tick = () => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount === 0) { try { ws.close() } catch {}; return }
      setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  }
  const finish = () => { ftDiag('complete', { sinceLaunchMs: launchedAt ? Date.now() - launchedAt : null }); done = true; stop(); closeWhenFlushed() }

  // ---- claude/coco: idle-gated step machine (paste split from Enter; image split from prompt) ----
  const emit = (kind: SubmitEmit): void => {
    if (ws.readyState !== WebSocket.OPEN) {
      // The query is being dropped HERE: the step fired but the socket already closed. This is the
      // root-cause signature of the silent first-turn loss — surface it loudly in the trace.
      ftDiag('emit_skipped', { kind, level: 'warn', reason: 'socket_not_open', readyState: ws.readyState })
      return
    }
    if (kind === 'images') { for (const img of images) ws.send(JSON.stringify({ t: 'img', name: img.name || 'paste', d: img.dataUrl })) }
    else if (kind === 'paste') { if (prompt) ws.send(JSON.stringify({ t: 'i', d: `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~` })) }
    else if (kind === 'enter') ws.send(JSON.stringify({ t: 'i', d: '\r' }))
  }
  const steps = useStepper ? firstTurnSteps({ hasImages, hasPrompt: !!prompt }) : []
  let stepIdx = 0
  let stepStartedAt = 0
  let outLenAtStep = 0
  const advanceStep = (now: number) => { stepStartedAt = now; outLenAtStep = recentOutput.length }
  const tick = () => {
    if (done || ws.readyState !== WebSocket.OPEN || stepIdx >= steps.length) return
    const now = Date.now()
    const quietMs = now - (lastDataAt || now)
    const elapsedSinceStepMs = now - stepStartedAt
    if (!steps[stepIdx].ready({
      recentOutput,
      newOutputSinceStep: recentOutput.slice(outLenAtStep),
      quietMs,
      elapsedSinceStepMs,
    })) return
    // Record the decision context BEFORE emitting: which step, how it tripped (output went quiet vs the
    // time-based backstop), whether the bracketed-paste marker is still visible (it scrolls out of the
    // 8KB window during claude's verbose banner), and how much output we've buffered. emit() then logs
    // emit_skipped if the socket has since closed.
    ftDiag('step_emit', {
      step: steps[stepIdx].emit, idx: stepIdx, quietMs, elapsedSinceStepMs,
      markerSeen: recentOutput.includes(BRACKETED_PASTE_READY), outLen: recentOutput.length,
      sinceLaunchMs: launchedAt ? now - launchedAt : null,
    })
    emit(steps[stepIdx].emit)
    // Our own send is activity too: reset the idle clock so the NEXT step waits for the CLI to receive,
    // echo, and settle — else quietMs (time since last *received* frame) is already high and the next
    // step (e.g. Enter) fires before the CLI has rendered what we just pasted. (Verified: a 119ms
    // Enter-after-paste raced the echo and dropped the turn.)
    lastDataAt = now
    stepIdx++
    if (stepIdx >= steps.length) { finish(); return }
    advanceStep(now)
  }

  // ---- legacy marker-based path (non-claude/coco image launches) ----
  let imagesSent = false
  let promptSent = false
  let legacyFallback: ReturnType<typeof setTimeout> | undefined
  const legacySubmitPrompt = (): void => {
    if (promptSent || !imagesSent || ws.readyState !== WebSocket.OPEN) return
    promptSent = true; done = true
    if (legacyFallback) clearTimeout(legacyFallback)
    if (prompt) ws.send(JSON.stringify({ t: 'i', d: `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r` }))
    else ws.send(JSON.stringify({ t: 'i', d: '\r' }))
    closeWhenFlushed()
  }
  const legacyPump = (): void => {
    if (!legacyImage || !launchedId) return
    if (!imagesSent) {
      if (!recentOutput.includes(BRACKETED_PASTE_READY)) return
      imagesSent = true
      for (const img of images) ws.send(JSON.stringify({ t: 'img', name: img.name || 'paste', d: img.dataUrl }))
      legacyFallback = setTimeout(legacySubmitPrompt, IMAGE_ATTACH_FALLBACK_MS)
    } else if (!promptSent && recentOutput.includes(IMAGE_ATTACH_MARK)) {
      legacySubmitPrompt()
    }
  }

  // Model B: deliver images + prompt as one structured turn the instant the session launches.
  const sendStreamTurn = (): void => {
    if (ws.readyState !== WebSocket.OPEN) return
    done = true
    ws.send(JSON.stringify({ t: 'turn', text: prompt, images, clientTurnId: `launch_${launch.launchToken}` }))
    closeWhenFlushed()
  }

  ws.onmessage = (e) => {
    const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
    if (data.startsWith('{"__berth"')) {
      try {
        const msg = JSON.parse(data)
        if (msg.__berth === 'launched' && msg.sessionId) {
          launchedId = msg.sessionId
          lastDataAt = Date.now()
          logDiag('connect', 'prime_launched', { launchToken: tok, cli: launch.cli, sessionId: msg.sessionId, bound: msg.bound })
          void onLaunched?.(msg.sessionId)
          if (stream) { if (hasImages) sendStreamTurn(); else closeSoon() }
          else if (useStepper && steps.length) { launchedAt = Date.now(); ftDiag('armed', { steps: steps.length }); advanceStep(Date.now()); poll = setInterval(tick, POLL_INTERVAL_MS) }
          else if (legacyImage) { legacyPump() }
          else { closeSoon() }   // codex/task text rode the URL positional → server fired it
        }
        return
      } catch {
        /* not a control frame — fall through */
      }
    }
    if (!stream && launchedId && (useStepper || legacyImage)) {
      recentOutput = (recentOutput + data).slice(-8192)
      lastDataAt = Date.now()
      if (legacyImage) legacyPump()  // stepper is driven by its poll timer, not per-frame
    }
  }
  ws.onerror = () => { logDiag('connect', 'prime_error', { launchToken: tok, cli: launch.cli, level: 'error', sessionId: launchedId ?? undefined }); if ((useStepper || legacyImage) && !done) ftDiag('error', { level: 'error', stepIdx, steps: steps.length }); stop(); try { ws.close() } catch {} }
  // Safety: never let a first-turn socket linger if the CLI never reaches a submittable state. If this
  // fires the first turn was NEVER delivered (stuck before all steps) — log it as the failure it is, with
  // how far the stepper got, so the trace shows "armed but never completed" vs a clean complete.
  if (useStepper || legacyImage) setTimeout(() => {
    if (!done) {
      ftDiag('timeout', { level: 'warn', stepIdx, steps: steps.length, launched: !!launchedId, sinceLaunchMs: launchedAt ? Date.now() - launchedAt : null })
      stop(); try { ws.close() } catch {}
    }
  }, PRIME_PAYLOAD_TIMEOUT_MS)
}

export function startFreshLaunch(input: StartFreshLaunchInput): string {
  const d = input.cargo
    ? deriveLaunch(input.cargo)
    : { cwd: '', addDirs: [] as string[], ctxProject: true, ctxTask: input.dest === 'task' }
  const cwd = d.cwd
  const cwdLabel = cwd ? shortCwd(cwd) : '项目默认目录'
  const pendingCwd = cwd || input.project?.workspaceCwd || ''
  const launchToken = input.makeLaunchToken?.() ?? crypto.randomUUID()
  const createdAt = input.now?.() ?? Date.now()

  logDiag('launch', 'start', {
    launchToken, cli: input.cli, dest: input.dest, projectId: input.projectId ?? undefined,
    todoKey: input.todoKey ?? undefined, hasPrompt: !!(input.freeText || input.taskNote),
    hasImages: !!input.images?.length,
  })

  input.addPending({
    tempId: launchToken,
    cli: input.cli,
    cwd: pendingCwd,
    cwdLabel,
    projectId: input.projectId ?? null,
    todoKey: input.todoKey ?? null,
    sessionId: null,
    knownIds: pendingCwd
      ? input.sessions.filter((s) => s.cli === input.cli && (s.cwd ?? '') === pendingCwd).map((s) => s.sessionId)
      : [],
    createdAt,
  })

  const drawerSession: LaunchDrawerSession = {
    title: input.title,
    cli: input.cli,
    cwd: cwdLabel,
    status: 'sail',
    task: input.dest === 'task' ? input.taskTitle : undefined,
    launch: {
      cli: input.cli,
      cwd,
      launchToken,
      projectId: input.projectId,
      todoKey: input.todoKey,
      prompt: input.dest === 'free' ? input.freeText || undefined : input.taskNote?.trim() || undefined,
      // Both destinations can carry images. Task context rides its own channel (env / system prompt /
      // SessionStart hooks — never the positional), so a task launch's images + note flow through the
      // same image+prompt prime-socket path as a free launch without colliding with it.
      images: input.images,
      addDirs: d.addDirs,
      ctxProject: d.ctxProject,
      ctxTask: input.dest === 'task' ? d.ctxTask : false,
    },
  }

  primeFreshLaunch(drawerSession.launch, async (sessionId) => {
    input.resolvePending?.(launchToken, sessionId)
    try {
      await input.resync?.()
    } catch {
      // The existing pending poll still retries; a launch handshake must not fail because resync did.
    }
  })
  input.openDrawer(drawerSession)

  return launchToken
}
