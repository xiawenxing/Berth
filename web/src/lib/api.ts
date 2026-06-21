// Thin typed client over the Berth Node REST API (proxied by Vite in dev, same-origin under /app).

export interface ApiPathMeta {
  cwd: string
  enabled: boolean
}

export interface ApiProject {
  id: string
  name: string
  archived?: boolean
  homeCwd?: string | null
  paths?: string[]
  pathsMeta?: ApiPathMeta[] // {cwd,enabled}[] — drives the 货舱 toggle UI
  workspaceCwd?: string // Berth-assigned default cwd (~/.berth/workspaces/<id>); masked in UI
  lastCwd?: string | null // sticky 主 cwd for the launch auto-pick
}

export interface ApiTask {
  id: string
  title: string
  status: string
  priority?: string
  projectId?: string | null
  project?: string
  progress?: string | null
  detailDoc?: string | null
  ddl?: string | null
  sessions?: string[]
  summarizing?: boolean // server is regenerating this task's progress summary right now
}

export type TurnRole = 'user' | 'agent' | 'tool'
export interface TranscriptTurn {
  role: TurnRole
  text: string
  collapsed?: boolean
}

export interface ApiSession {
  sessionId: string
  cli: string
  title?: string | null
  cwd?: string | null
  updatedAt: number
  pinned?: boolean
  projectId?: string | null
  project?: string
  todoKey?: string | null
  activity?: string | null
  deleted?: boolean
}

// Structured summary (港务助手): a one-line headline + progress bullets + milestone/TODO items.
// Shared by 项目小结 and the task 进展详情 popover.
export interface StructuredSummary {
  headline: string
  progress: string[]
  milestones: { text: string; done: boolean }[]
}

export type AgentCli = 'claude' | 'codex' | 'coco'

export interface AgentEntry {
  cli: AgentCli
  enabled: boolean
  model: string | null
}

export interface AgentConfig {
  list: AgentEntry[]
  berthAgentCli: AgentCli
  berthAgentModel: string
  headlessClis: AgentCli[]
}

export interface ApiSettings {
  priorities?: string[]
  statuses?: string[]
  agents?: AgentConfig
}

export interface PreviewSession {
  sessionId: string
  cli: string
  title: string | null
  cwd: string | null
  updatedAt: number
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return (await res.json()) as T
}

async function send(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`)
  return res.json().catch(() => ({}))
}

export const api = {
  projects: () => getJSON<{ projects: ApiProject[] }>('/api/projects'),
  todos: () => getJSON<{ todos: ApiTask[] }>('/api/todos'),
  sessions: () => getJSON<ApiSession[]>('/api/sessions'),
  // Re-scan the CLI session stores on disk into the server cache. `GET /api/sessions` only
  // returns that cache, so without this a session created after server start (launched from a
  // task, or started by hand in an imported dir) never surfaces. Returns the new session count.
  refresh: () => send('POST', '/api/refresh') as Promise<{ ok: boolean; count: number }>,
  // Task-field vocabularies (ordered priority + status lists, user-configurable in Settings).
  settings: () => getJSON<ApiSettings>('/api/settings'),
  saveSettings: (patch: { priorities?: string[]; statuses?: string[]; agents?: Partial<AgentConfig> }) => send('POST', '/api/settings', patch),
  // Structured codex-style chat turns for a real session's drawer/right-pane.
  transcript: (sessionId: string) =>
    getJSON<{ turns: TranscriptTurn[] }>(`/api/sessions/${sessionId}/transcript`),

  // ── mutations (wired to existing server endpoints) ──
  createTask: (text: string, projectId?: string, images?: string[]) => send('POST', '/api/todos', { text, projectId, images }),
  patchTask: (id: string, patch: { status?: string; priority?: string; ddl?: string | null; title?: string }) =>
    send('PATCH', `/api/todos/${id}`, patch),
  deleteTask: (id: string) => send('DELETE', `/api/todos/${id}`),
  pin: (sessionId: string, on: boolean) => send('POST', '/api/pin', { sessionId, on }),
  // Assign a session to a project (manual attach → state 'confirmed' server-side).
  attach: (sessionId: string, projectId: string) => send('POST', '/api/attach', { sessionId, projectId }),
  // Native macOS folder picker → absolute path (or cancelled).
  pickFolder: () => send('POST', '/api/pick-folder', {}) as Promise<{ path?: string; cancelled?: boolean }>,
  // Preview the sessions a candidate dir would surface (no state mutation).
  previewDir: (cwd: string) =>
    send('POST', '/api/session-dirs/preview', { cwd }) as Promise<{ sessions: PreviewSession[] }>,
  // Register a dir as an import root (surfaces its sessions to the store) + refresh.
  importDir: (cwd: string) => send('POST', '/api/session-dirs', { cwd }) as Promise<{ ok: boolean; count: number }>,
  createProject: (name: string, cwd?: string) => send('POST', '/api/projects/create', { name, cwd }),
  patchProject: (id: string, patch: { name?: string; hue?: string | null }) =>
    send('PATCH', `/api/projects/${encodeURIComponent(id)}`, patch),
  archiveProject: (projectId: string, on: boolean) =>
    send('POST', '/api/projects/archive', { projectId, on }),
  deleteProject: (id: string) => send('DELETE', `/api/projects/${encodeURIComponent(id)}`),
  // 货舱 registry mutations (real project_path data).
  addPath: (projectId: string, cwd: string, opts?: { isHome?: boolean; enabled?: boolean }) =>
    send('POST', '/api/projects/add-path', { projectId, cwd, ...opts }),
  togglePath: (projectId: string, cwd: string, enabled: boolean) =>
    send('POST', '/api/projects/path/toggle', { projectId, cwd, enabled }),
  removePath: (projectId: string, cwd: string) =>
    send('POST', '/api/projects/path/remove', { projectId, cwd }),
  // Session-grained import: mark sessions as in Berth's visible set (+ attach when projectId given).
  importSessions: (ids: string[], projectId?: string) =>
    send('POST', '/api/session-import', { ids, projectId }),
  contextUpdate: (kind: 'task' | 'project', key: string, userInput: string, images?: string[]) =>
    send('POST', '/api/context/update', { kind, key, userInput, images }),
  // Read the cached 项目小结 + whether a (re)generation is in flight (null summary if never generated).
  getProjectSummary: (id: string) =>
    getJSON<{ summary: StructuredSummary | null; generatedAt?: number; summarizing?: boolean }>(`/api/projects/${id}/summary`),
  // Kick a (re)generation; returns immediately — generation runs detached server-side, poll the GET.
  projectSummary: (id: string) =>
    send('POST', `/api/projects/${id}/summary`, {}) as Promise<{ summarizing?: boolean; error?: string }>,
  // Structured 任务进展详情 (behind the task card's 更多 popover): GET reads cache + summarizing flag,
  // POST kicks a detached (re)generation (same as the status-change auto-trigger).
  getTaskSummaryDetail: (id: string) =>
    getJSON<{ summary: StructuredSummary | null; generatedAt?: number; summarizing?: boolean }>(`/api/todos/${id}/summary-detail`),
  taskSummaryDetail: (id: string) =>
    send('POST', `/api/todos/${id}/summary-detail`, {}) as Promise<{ summarizing?: boolean; error?: string }>,
  sessionTitle: (id: string) => send('POST', `/api/sessions/${id}/title`, {}) as Promise<{ title: string }>,
  renameSessionTitle: (id: string, title: string) =>
    send('PATCH', `/api/sessions/${id}/title`, { title }) as Promise<{ title: string }>,
  // Context doc read/write (docstore-relative `path`/ref; POST guards on baseMtime).
  readDoc: (path: string) => getJSON<{ content: string; mtime?: number }>(`/api/doc?path=${encodeURIComponent(path)}`),
  saveDoc: (path: string, content: string, baseMtime?: number) => send('POST', '/api/doc', { path, content, baseMtime }),
}
