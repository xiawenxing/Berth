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

function buildLaunchQuery(launch: LaunchDrawerSession['launch'], renderStream: boolean): URLSearchParams {
  const qs = new URLSearchParams({ new: '1', cli: launch.cli, cwd: launch.cwd, cols: '120', rows: '30' })
  if (renderStream) qs.set('render', 'stream-json')
  if (launch.launchToken) qs.set('launchToken', launch.launchToken)
  if (launch.projectId) qs.set('projectId', launch.projectId)
  if (launch.todoKey) qs.set('todoKey', launch.todoKey)
  if (launch.prompt && !launch.images?.length) qs.set('prompt', launch.prompt)
  if (launch.ctxProject === false) qs.set('ctxProject', '0')
  if (launch.ctxTask === false) qs.set('ctxTask', '0')
  for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
  return qs
}

const PRIME_PAYLOAD_TIMEOUT_MS = 60_000

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
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/pty?${buildLaunchQuery(launch, stream).toString()}`)
  ws.binaryType = 'arraybuffer'
  const tok = launch.launchToken
  logDiag('connect', 'prime_open', { launchToken: tok, cli: launch.cli, hasImages, mode: stream ? 'stream' : 'tui' })
  ws.onclose = () => logDiag('connect', 'prime_close', { launchToken: tok, cli: launch.cli, sessionId: launchedId ?? undefined })
  let launchedId: string | null = null
  let imagesSent = false
  let promptSent = false
  let promptFallback: ReturnType<typeof setTimeout> | undefined
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

  // Model A only: send the prompt as its own bracketed paste + Enter, exactly once. Split out from the
  // image send because the CLI drops the prompt if it arrives in the same burst as the image — it's
  // still attaching the just-pasted image when the prompt + Enter land, so only the image survives.
  // We instead fire this on the CLI's next output frame (its image-paste ack), mirroring the gap a
  // human leaves when they paste an image and then type. A fallback timer covers a silent CLI.
  const sendPromptModelA = (): void => {
    if (promptSent || !imagesSent || ws.readyState !== WebSocket.OPEN) return
    promptSent = true
    if (promptFallback) clearTimeout(promptFallback)
    const prompt = launch.prompt?.trim()
    if (prompt) ws.send(JSON.stringify({ t: 'i', d: `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r` }))
    else ws.send(JSON.stringify({ t: 'i', d: '\r' }))
    closeWhenFlushed()
  }

  // Submit the image-backed first turn exactly once. Mirrors what the drawer terminal/chat used to do,
  // now owned here. Returns false until it actually fires (Model A waits for bracketed-paste readiness).
  const sendImagePayload = (): boolean => {
    if (imagesSent || !hasImages || ws.readyState !== WebSocket.OPEN) return false
    const prompt = launch.prompt?.trim()
    if (stream) {
      // Model B: one structured turn carrying the images + prompt.
      imagesSent = true
      promptSent = true
      ws.send(JSON.stringify({ t: 'turn', text: prompt ?? '', images, clientTurnId: `launch_${launch.launchToken}` }))
      closeWhenFlushed()
      return true
    }
    // Model A (TUI): wait until the CLI enables bracketed paste, else the escape markers echo as
    // literal text during startup. Send only the images now — the prompt follows on the next frame
    // (see onmessage), once the CLI has acknowledged the image paste.
    if (!recentOutput.includes('\x1b[?2004h')) return false
    imagesSent = true
    for (const img of images) ws.send(JSON.stringify({ t: 'img', name: img.name || 'paste', d: img.dataUrl }))
    // Fallback: if the CLI emits no further frame, never strand the prompt.
    promptFallback = setTimeout(sendPromptModelA, 1200)
    return true
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
          if (!hasImages) closeSoon()       // prompt rode the URL → server already fired it
          else sendImagePayload()           // Model B fires now; Model A waits for the marker below
        }
        return
      } catch {
        /* not a control frame — fall through */
      }
    }
    if (hasImages && !stream && launchedId) {
      recentOutput = (recentOutput + data).slice(-4096)
      if (!imagesSent) sendImagePayload()
      else sendPromptModelA()   // a frame after the images = the CLI ack'd the paste → send the prompt now
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
