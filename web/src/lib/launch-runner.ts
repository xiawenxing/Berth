import type { AgentCli, ApiProject, ApiSession } from './api'
import { shortCwd } from './format'
import { deriveLaunch, type CargoState } from './launch-cargo'

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

function primeFreshLaunch(launch: LaunchDrawerSession['launch'], onLaunched?: (sessionId: string) => void): void {
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
  // Image-backed launches still need the visible terminal/chat socket to submit images after the CLI
  // is ready. Prompt-only and empty launches can be spawned in the background immediately so closing
  // the drawer cannot cancel the launch before the /pty WebSocket connects.
  if (launch.images?.length) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/pty?${buildLaunchQuery(launch, streamRenderEnabled()).toString()}`)
  const closeSoon = () => setTimeout(() => { try { ws.close() } catch {} }, 100)
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string' || !e.data.startsWith('{"__berth"')) return
    try {
      const msg = JSON.parse(e.data)
      if (msg.__berth === 'launched' && msg.sessionId) {
        onLaunched?.(msg.sessionId)
        closeSoon()
      }
    } catch {
      /* ignore non-control frames */
    }
  }
  ws.onerror = closeSoon
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
      images: input.dest === 'free' ? input.images : undefined,
      addDirs: d.addDirs,
      ctxProject: d.ctxProject,
      ctxTask: input.dest === 'task' ? d.ctxTask : false,
    },
  }

  primeFreshLaunch(drawerSession.launch, (sessionId) => input.resolvePending?.(launchToken, sessionId))
  input.openDrawer(drawerSession)

  return launchToken
}
