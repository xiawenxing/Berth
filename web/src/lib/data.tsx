import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type ApiProject, type ApiSession, type ApiTask } from './api'

// One fetch of the whole dataset, shared across pages via context. Refetchable.
// Live running/unread status (from the /status WS + local lastSeen) is a follow-up;
// for now ship status defaults to 已停泊 and 'pinned' drives the Pin section.

interface DataState {
  projects: ApiProject[]
  tasks: ApiTask[]
  sessions: ApiSession[]
  loading: boolean
  error: string | null
  reload: () => void
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([api.projects(), api.todos(), api.sessions()])
      .then(([p, t, s]) => {
        if (!alive) return
        setProjects(p.projects ?? [])
        setTasks(t.todos ?? [])
        setSessions((s ?? []).filter((x) => !x.deleted))
        setError(null)
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [nonce])

  const value = useMemo<DataState>(
    () => ({ projects, tasks, sessions, loading, error, reload: () => setNonce((n) => n + 1) }),
    [projects, tasks, sessions, loading, error],
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

const KNOWN_STATUS = new Set(['待办', '进行中', '待评估', '已完成', '已取消'])
/** Map any backend status onto the v7 board columns (unknown → 进行中 bucket-ish: 待评估). */
export function normStatus(s: string): '待办' | '进行中' | '待评估' | '已完成' | '已取消' {
  if (KNOWN_STATUS.has(s)) return s as any
  if (s === '阻塞' || s === '合并中' || s === '验证中') return '进行中'
  return '待办'
}

export function normPriority(p?: string): 'P0' | 'P1' | 'P2' {
  if (p === 'P0' || p === 'P1' || p === 'P2') return p
  return 'P2'
}
