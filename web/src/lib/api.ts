// Thin typed client over the Berth Node REST API (proxied by Vite in dev, same-origin under /app).

export interface ApiProject {
  id: string
  name: string
  archived?: boolean
  homeCwd?: string | null
  paths?: string[]
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

  // ── mutations (wired to existing server endpoints) ──
  createTask: (text: string, projectId?: string) => send('POST', '/api/todos', { text, projectId }),
  patchTask: (id: string, patch: { status?: string; priority?: string; ddl?: string | null; title?: string }) =>
    send('PATCH', `/api/todos/${id}`, patch),
  deleteTask: (id: string) => send('DELETE', `/api/todos/${id}`),
  taskSummary: (id: string) => send('POST', `/api/todos/${id}/progress-summary`, {}),
  pin: (sessionId: string, on: boolean) => send('POST', '/api/pin', { sessionId, on }),
  // Assign a session to a project (manual attach → state 'confirmed' server-side).
  attach: (sessionId: string, projectId: string) => send('POST', '/api/attach', { sessionId, projectId }),
  createProject: (name: string, cwd?: string) => send('POST', '/api/projects/create', { name, cwd }),
  contextUpdate: (kind: 'task' | 'project', key: string, userInput: string) =>
    send('POST', '/api/context/update', { kind, key, userInput }),
  projectSummary: (id: string) => send('POST', `/api/projects/${id}/summary`, {}) as Promise<{ summary?: string; error?: string }>,
  sessionTitle: (id: string) => send('POST', `/api/sessions/${id}/title`, {}),
  // Context doc read/write (docstore-relative `path`/ref; POST guards on baseMtime).
  readDoc: (path: string) => getJSON<{ content: string; mtime?: number }>(`/api/doc?path=${encodeURIComponent(path)}`),
  saveDoc: (path: string, content: string, baseMtime?: number) => send('POST', '/api/doc', { path, content, baseMtime }),
}
