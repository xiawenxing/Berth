import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type ApiProject, type ApiSession, type ApiTask } from './api'
import { DEFAULT_STATUSES } from './status'

// One fetch of the whole dataset, shared across pages via context. Refetchable.
// Live running/unread status (from the /status WS + local lastSeen) is a follow-up;
// for now ship status defaults to 已停泊 and 'pinned' drives the Pin section.

const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2']

interface DataState {
  projects: ApiProject[]
  tasks: ApiTask[]
  sessions: ApiSession[]
  priorities: string[] // ordered high→low, from Settings (drives the priority color ramp + menu)
  statuses: string[] // ordered vocabulary, from Settings (drives the kanban columns + status menu)
  loading: boolean
  error: string | null
  /** Re-read the server cache (cheap; does NOT re-scan disk). */
  reload: () => void
  /** Re-scan the CLI session stores on disk (POST /api/refresh) then re-read. Use after a fresh
   *  launch or to pick up sessions started by hand — `reload()` alone can't surface a new session. */
  resync: () => Promise<void>
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [priorities, setPriorities] = useState<string[]>(DEFAULT_PRIORITIES)
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    // Settings is non-critical: fall back to the default vocabulary if it fails, don't break the page.
    Promise.all([api.projects(), api.todos(), api.sessions(), api.settings().catch(() => ({}))])
      .then(([p, t, s, cfg]) => {
        if (!alive) return
        setProjects(p.projects ?? [])
        setTasks(t.todos ?? [])
        setSessions((s ?? []).filter((x) => !x.deleted))
        const c = cfg as { priorities?: string[]; statuses?: string[] }
        setPriorities(c.priorities?.length ? c.priorities : DEFAULT_PRIORITIES)
        setStatuses(c.statuses?.length ? c.statuses : DEFAULT_STATUSES)
        setError(null)
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [nonce])

  const value = useMemo<DataState>(
    () => ({
      projects,
      tasks,
      sessions,
      priorities,
      statuses,
      loading,
      error,
      reload: () => setNonce((n) => n + 1),
      resync: async () => {
        // Best-effort disk re-scan; even if it fails, refetch so the cache view is current.
        await api.refresh().catch(() => {})
        setNonce((n) => n + 1)
      },
    }),
    [projects, tasks, sessions, priorities, statuses, loading, error],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData must be used within DataProvider')
  return v
}

// ── mappers / helpers ──────────────────────────────────────────────────────

export function relTime(epochSec: number): string {
  const s = Math.floor(Date.now() / 1000) - epochSec
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`
  if (s < 172800) return '昨天'
  if (s < 604800) return `${Math.floor(s / 86400)}天前`
  return `${Math.floor(s / 604800)}周前`
}

export function shortCwd(cwd?: string | null): string {
  if (!cwd) return ''
  const home = '/Users/'
  return cwd.startsWith(home) ? '~/' + cwd.split('/').slice(3).join('/') : cwd
}

/** Pass the configured priority through as-is (ranked/colored by its position in the Settings
 *  list, see lib/priority.ts); only fall back when the backend gives nothing. */
export function normPriority(p?: string): string {
  return p && p.trim() ? p.trim() : 'P2'
}
