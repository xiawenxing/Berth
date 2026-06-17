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

export const api = {
  projects: () => getJSON<{ projects: ApiProject[] }>('/api/projects'),
  todos: () => getJSON<{ todos: ApiTask[] }>('/api/todos'),
  sessions: () => getJSON<ApiSession[]>('/api/sessions'),
}
