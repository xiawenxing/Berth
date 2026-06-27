import type { AgentCli, ApiProject, ApiSession } from './api'
import { shortCwd } from './format'
import { deriveLaunch, type CargoState } from './launch-cargo'
import { logDiag } from './diag'

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
// The CLI's TUI announces bracketed-paste support (composer is up) with this marker.
const BRACKETED_PASTE_READY = '\x1b[?2004h'
// Claude/Codex echo the pasted image path back as an attachment chip ("[Image #1]") once it's truly
// attached. That — not the next arbitrary redraw — is when the prompt's Enter is safe to send.
const IMAGE_ATTACH_MARK = '[Image'
// Fallbacks so a CLI that never echoes the expected marker still submits the first turn rather than
// stranding it: after the image goes out, and after the launched frame for a text-only socket submit.
const IMAGE_ATTACH_FALLBACK_MS = 3_000
const TEXT_READY_FALLBACK_MS = 8_000

/**
 * A drawer-INDEPENDENT socket that drives a fresh launch to completion so closing the drawer
 * mid-creation can never drop the session or its first turn.
 *
 * - Prompt-only / empty launches: the prompt rides the URL, so the server fires the first turn at
 *   spawn. This socket only confirms the {launched} frame, then closes.
 * - Image-backed launches: images can't ride a URL, so the first turn (images + prompt) MUST be
 *   submitted over a live socket after the CLI is ready. Doing that here — not on the visible
 *   terminal/chat socket — means it survives the drawer being closed. The drawer sockets are pure
 *   viewers (they no longer auto-submit), so exactly one socket submits the payload.
 */
function primeFreshLaunch(launch: LaunchDrawerSession['launch'], onLaunched?: (sessionId: string) => void | Promise<void>): void {
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
  const stream = streamRenderEnabled()
  const images = (launch.images ?? []).filter((img) => img.dataUrl)
  const hasImages = images.length > 0
  const prompt = launch.prompt?.trim() ?? ''
  // Model A claude/coco free launch: this socket owns the first-turn submit (the prompt did NOT ride
  // the URL). For images, the prime socket always owns the submit (images can't ride a URL).
  const socketText = !stream && !hasImages && wantsSocketTextSubmit(launch)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/pty?${buildLaunchQuery(launch, stream).toString()}`)
  ws.binaryType = 'arraybuffer'
  const tok = launch.launchToken
  logDiag('connect', 'prime_open', { launchToken: tok, cli: launch.cli, hasImages, mode: stream ? 'stream' : 'tui' })
  ws.onclose = () => logDiag('connect', 'prime_close', { launchToken: tok, cli: launch.cli, sessionId: launchedId ?? undefined })
  let launchedId: string | null = null
  let imagesSent = false
  let promptSent = false
  let fallback: ReturnType<typeof setTimeout> | undefined
  let recentOutput = ''

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

  // Submit the prompt as its own bracketed paste + Enter, exactly once. For image launches this MUST
  // wait until the image is attached (imagesSent + the attach confirmation, see below) — sending the
  // prompt + Enter while the CLI is still attaching makes it submit an image-less turn and strand the
  // image in the composer (the reported bug). A fallback timer covers a CLI that never echoes a marker.
  const submitPrompt = (): void => {
    if (promptSent || ws.readyState !== WebSocket.OPEN) return
    if (hasImages && !imagesSent) return
    promptSent = true
    if (fallback) clearTimeout(fallback)
    if (prompt) ws.send(JSON.stringify({ t: 'i', d: `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r` }))
    else ws.send(JSON.stringify({ t: 'i', d: '\r' }))
    closeWhenFlushed()
  }

  // Model B: deliver images + prompt as one structured turn the instant the session launches.
  const sendStreamTurn = (): void => {
    if (imagesSent || ws.readyState !== WebSocket.OPEN) return
    imagesSent = true
    promptSent = true
    ws.send(JSON.stringify({ t: 'turn', text: prompt, images, clientTurnId: `launch_${launch.launchToken}` }))
    closeWhenFlushed()
  }

  // Model A: paste the images once the CLI has enabled bracketed paste (else the escape markers echo
  // as literal text during startup). The prompt follows only after the attach confirmation (pump()).
  const sendImages = (): boolean => {
    if (imagesSent || !hasImages || ws.readyState !== WebSocket.OPEN) return false
    if (!recentOutput.includes(BRACKETED_PASTE_READY)) return false
    imagesSent = true
    for (const img of images) ws.send(JSON.stringify({ t: 'img', name: img.name || 'paste', d: img.dataUrl }))
    fallback = setTimeout(submitPrompt, IMAGE_ATTACH_FALLBACK_MS)
    return true
  }

  // Model A driver: from the latest output, do whatever this launch still owes. Idempotent.
  const pump = (): void => {
    if (stream || !launchedId) return
    if (hasImages) {
      if (!imagesSent) { sendImages(); return }
      if (!promptSent && recentOutput.includes(IMAGE_ATTACH_MARK)) submitPrompt()
    } else if (socketText) {
      if (!promptSent && recentOutput.includes(BRACKETED_PASTE_READY)) submitPrompt()
    }
  }

  ws.onmessage = (e) => {
    const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
    if (data.startsWith('{"__berth"')) {
      try {
        const msg = JSON.parse(data)
        if (msg.__berth === 'launched' && msg.sessionId) {
          launchedId = msg.sessionId
          logDiag('connect', 'prime_launched', { launchToken: tok, cli: launch.cli, sessionId: msg.sessionId, bound: msg.bound })
          void onLaunched?.(msg.sessionId)
          if (stream) {
            if (hasImages) sendStreamTurn()   // Model B: one structured turn now
            else closeSoon()                  // prompt rode the URL → server delivers it over stdin
          } else if (hasImages || socketText) {
            // Arm a safety fallback so a silent CLI never strands the first turn, then try now in case
            // the readiness marker is already buffered.
            if (socketText) fallback = setTimeout(submitPrompt, TEXT_READY_FALLBACK_MS)
            pump()
          } else {
            closeSoon()                       // codex/task text rode the URL positional → server fired it
          }
        }
        return
      } catch {
        /* not a control frame — fall through */
      }
    }
    if (!stream && launchedId && (hasImages || socketText)) {
      recentOutput = (recentOutput + data).slice(-4096)
      pump()
    }
  }
  ws.onerror = () => { logDiag('connect', 'prime_error', { launchToken: tok, cli: launch.cli, level: 'error', sessionId: launchedId ?? undefined }); try { ws.close() } catch {} }
  // Safety: never let an image-launch socket linger if the CLI never announces paste readiness.
  if (hasImages) setTimeout(() => { if (!imagesSent) { try { ws.close() } catch {} } }, PRIME_PAYLOAD_TIMEOUT_MS)
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
