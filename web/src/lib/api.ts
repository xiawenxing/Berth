// Thin typed client over the Berth Node REST API (proxied by Vite in dev).
// Response shapes are best-effort from docs/ARCHITECTURE.md and refined as pages wire real data.

export interface Project {
  id: string
  name: string
  archived?: boolean
  homeCwd?: string | null
  paths?: string[]
}

export interface Task {
  id: string
  title: string
  status: string
  priority?: string
  project?: string
  progress?: string
  detailDoc?: string | null
  sessions?: string[]
  ddl?: string | null
}

export interface Session {
  sessionId: string
  cli: string
  title?: string | null
  cwd?: string | null
  updatedAt: number
  pinned?: boolean
  projectId?: string | null
  todoKey?: string | null
  attachState?: string
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  projects: () => getJSON<{ projects: Project[] }>('/api/projects'),
  todos: () => getJSON<{ todos: Task[] }>('/api/todos'),
  sessions: () => getJSON<Session[]>('/api/sessions'),
}
