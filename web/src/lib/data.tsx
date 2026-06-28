import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type AgentConfig, type ApiProject, type ApiSession, type ApiSettings, type ApiTask } from './api'
import { DEFAULT_STATUSES } from './status'

// A fresh launch in flight: shown as an optimistic "创建中…" placeholder in the lists until its
// real session surfaces on disk (and in /api/sessions). Reconciled away by exact session id (claude/
// coco mint it deterministically) or, failing that, the first new same-cli+cwd session (codex, whose
// real id is assigned later by reconcile-on-refresh).
export interface PendingLaunch {
  tempId: string // the launchToken (stable across the launch)
  cli: string
  cwd: string // real matching cwd; project-default launches use the resolved workspace cwd when known
  cwdLabel: string // display form
  projectId: string | null
  todoKey: string | null
  sessionId: string | null // exact id from the {"__berth":"launched"} frame, once known
  knownIds: string[] // same-cli+cwd session ids present at launch (so we can spot the NEW one)
  createdAt: number // ms; placeholders age out after PENDING_TTL_MS so a failed launch can't wedge
  surfaced?: boolean // real session is visible; keep polling only for delayed codex title backfill
}

// While a launch is in flight we re-scan disk on this cadence until the session surfaces — the old
// fixed 3-shot resync (800/2500/6000ms) gave up after 6s, but a slow CLI (notably coco's network/
// update check) writes its session.json well past that, so the session never appeared without a
// manual 同步. Placeholders also self-expire so a launch that never produces a session can't poll forever.
const PENDING_POLL_MS = 2500
const PENDING_TTL_MS = 120_000
const LAUNCHED_PENDING_TTL_MS = 30 * 60_000
const cwdKey = (c: string) => (c || '').replace(/\/+$/, '')

// Does a surfaced session belong to this in-flight launch? Used for the codex fallback match (no
// deterministic id), where cli+cwd alone is ambiguous: two launches can share a cwd (one for a task,
// one free-ask; or two different tasks). Discriminate by todoKey/projectId too so concurrent launches
// in the same cwd don't cross-match and steal each other's placeholder. (Ported from Berth 1.0's
// `sessionMatchesPendingLaunch` — the "fix launch project scope for shared cwd" fix.)
function sessionMatchesPending(s: ApiSession, p: PendingLaunch): boolean {
  if (s.cli !== p.cli) return false
  if (cwdKey(s.cwd ?? '') !== cwdKey(p.cwd)) return false
  if (p.knownIds.includes(s.sessionId)) return false
  if (p.todoKey ? s.todoKey !== p.todoKey : !!s.todoKey) return false
  if (p.projectId) return s.projectId === p.projectId
  return s.projectId == null
}

function findSurfacedSession(sessions: ApiSession[], p: PendingLaunch): ApiSession | undefined {
  if (p.sessionId) {
    const exact = sessions.find((s) => s.sessionId === p.sessionId)
    if (exact) return exact
  }
  // Codex's first launched frame reports the temporary intent id. Until the status rekey event gives
  // us the real id, only use the same-cwd fallback when the launch had a concrete cwd; the project
  // workspace fallback is sent as "" and must not match arbitrary no-cwd rows.
  if (!p.cwd) return undefined
  return sessions.find((s) => sessionMatchesPending(s, p))
}

function needsTitleBackfill(p: PendingLaunch, s: ApiSession): boolean {
  // codex and coco both surface before their title is written (codex: thread_name; coco: session.json
  // metadata.title lands a few seconds after the session file is created). Keep the refresh loop alive
  // until the title backfills. claude writes its first user message into the transcript at creation, so
  // it surfaces title-complete and never needs this.
  return (p.cli === 'codex' || p.cli === 'coco') && !s.title
}

// One fetch of the whole dataset, shared across pages via context. Refetchable.
// Live running/unread status (from the /status WS + local lastSeen) is a follow-up;
// for now ship status defaults to 已停泊 and 'pinned' drives the Pin section.

const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2']
const DEFAULT_AGENTS: AgentConfig = {
  list: [
    { cli: 'claude', enabled: true, model: null },
    { cli: 'codex', enabled: true, model: null },
    { cli: 'coco', enabled: true, model: null },
  ],
  berthAgentCli: 'claude',
  berthAgentModel: 'claude-haiku-4-5',
  headlessClis: ['claude', 'codex'],
}

interface DataState {
  projects: ApiProject[]
  tasks: ApiTask[]
  sessions: ApiSession[]
  priorities: string[] // ordered high→low, from Settings (drives the priority color ramp + menu)
  statuses: string[] // ordered vocabulary, from Settings (drives the kanban columns + status menu)
  agents: AgentConfig // real launch/headless agent config from Settings
  loading: boolean
  error: string | null
  /** In-flight fresh launches not yet surfaced as real sessions (optimistic "创建中…" placeholders). */
  pending: PendingLaunch[]
  /** Register an optimistic placeholder for a fresh launch (called from the launch dialog). */
  addPending: (p: PendingLaunch) => void
  /** Record a launch's real session id once the server's launched-frame reports it. */
  resolvePending: (tempId: string, sessionId: string) => void
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
  const [agents, setAgents] = useState<AgentConfig>(DEFAULT_AGENTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [pending, setPending] = useState<PendingLaunch[]>([])

  const addPending = useCallback((p: PendingLaunch) => {
    setPending((cur) => [...cur.filter((x) => x.tempId !== p.tempId), p])
  }, [])
  const resolvePending = useCallback((tempId: string, sessionId: string) => {
    setPending((cur) => cur.map((x) => (x.tempId === tempId ? { ...x, sessionId } : x)))
  }, [])

  useEffect(() => {
    const onRekey = (e: Event) => {
      const detail = (e as CustomEvent<{ from?: string; to?: string }>).detail
      if (!detail?.from || !detail?.to) return
      const { from, to } = detail
      setPending((cur) => cur.map((p) => (p.sessionId === from ? { ...p, sessionId: to } : p)))
    }
    window.addEventListener('berth:session-rekey', onRekey)
    return () => window.removeEventListener('berth:session-rekey', onRekey)
  }, [])

  // Live refetch when the backend signals task data changed (CLI / API / another process). Debounced
  // so a burst of {t:data} frames coalesces into one reload. Mirrors the rekey listener above.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onDataChanged = () => { if (t) return; t = setTimeout(() => { t = null; setNonce((n) => n + 1) }, 200) }
    window.addEventListener('berth:data-changed', onDataChanged)
    return () => { window.removeEventListener('berth:data-changed', onDataChanged); if (t) clearTimeout(t) }
  }, [])

  // Drop a visible placeholder the moment its real session surfaces — by exact id (claude/coco) or by
  // the first new same-cli+cwd session (codex, bound late by reconcile) — or when it ages out.
  // Codex can surface before it has written a title/thread_name; keep a hidden pending watcher alive
  // so the normal refresh loop continues until the title backfills.
  useEffect(() => {
    if (pending.length === 0) return
    const now = Date.now()
    let changed = false
    const next: PendingLaunch[] = []
    for (const p of pending) {
      const ttl = p.sessionId ? LAUNCHED_PENDING_TTL_MS : PENDING_TTL_MS
      const expired = now - p.createdAt >= ttl
      const surfaced = findSurfacedSession(sessions, p)
      if (surfaced) {
        if (!expired && needsTitleBackfill(p, surfaced)) {
          const updated = p.surfaced && p.sessionId === surfaced.sessionId ? p : { ...p, sessionId: surfaced.sessionId, surfaced: true }
          next.push(updated)
          if (updated !== p) changed = true
        } else {
          changed = true
        }
      } else if (!expired) {
        next.push(p)
      } else {
        changed = true
      }
    }
    if (changed || next.length !== pending.length) setPending(next)
  }, [sessions, pending])

  // While anything is in flight, keep re-scanning disk until it surfaces (then `pending` empties and
  // this stops). Replaces SessionDrawer's old give-up-after-6s resync.
  useEffect(() => {
    if (pending.length === 0) return
    let cancelled = false
    const tick = async () => {
      await api.refresh().catch(() => {})
      if (!cancelled) setNonce((n) => n + 1)
    }
    void tick() // immediate, so fast CLIs surface without waiting a full interval
    const iv = setInterval(() => void tick(), PENDING_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [pending.length])

  useEffect(() => {
    let alive = true
    setLoading(true)
    // Settings is non-critical: fall back to the default vocabulary if it fails, don't break the page.
    Promise.all([api.projects(), api.todos(), api.sessions(), api.settings().catch((): ApiSettings => ({}))])
      .then(([p, t, s, cfg]) => {
        if (!alive) return
        setProjects(p.projects ?? [])
        setTasks(t.todos ?? [])
        setSessions((s ?? []).filter((x) => !x.deleted))
        const c = cfg
        setPriorities(c.priorities?.length ? c.priorities : DEFAULT_PRIORITIES)
        setStatuses(c.statuses?.length ? c.statuses : DEFAULT_STATUSES)
        setAgents(c.agents ?? DEFAULT_AGENTS)
        setError(null)
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [nonce])

  // While any task's progress summary is regenerating server-side, poll todos so the card's loading
  // icon clears (and the fresh summary shows) without a manual reload. Idle otherwise — no summary
  // in flight, no polling.
  const anySummarizing = tasks.some((t) => t.summarizing)
  useEffect(() => {
    if (!anySummarizing) return
    const iv = setInterval(() => {
      api.todos().then((t) => setTasks(t.todos ?? [])).catch(() => {})
    }, 2000)
    return () => clearInterval(iv)
  }, [anySummarizing])

  // Same pattern for detached session-title generation: poll sessions while any title is being
  // generated, so the spinner clears and the new title appears even if the run was kicked elsewhere
  // (or the drawer was closed mid-run).
  const anyTitleGenerating = sessions.some((s) => s.titleGenerating)
  useEffect(() => {
    if (!anyTitleGenerating) return
    const iv = setInterval(() => {
      api.sessions().then((s) => setSessions((s ?? []).filter((x) => !x.deleted))).catch(() => {})
    }, 2000)
    return () => clearInterval(iv)
  }, [anyTitleGenerating])

  // And for detached 项目小结 generation: poll projects while any project's 小结 is regenerating, so the
  // 小结 button spinner reflects it even with the popover closed.
  const anyProjSummarizing = projects.some((p) => p.summarizing)
  useEffect(() => {
    if (!anyProjSummarizing) return
    const iv = setInterval(() => {
      api.projects().then((p) => setProjects(p.projects ?? [])).catch(() => {})
    }, 2000)
    return () => clearInterval(iv)
  }, [anyProjSummarizing])

  const value = useMemo<DataState>(
    () => ({
      projects,
      tasks,
      sessions,
      priorities,
      statuses,
      agents,
      loading,
      error,
      pending,
      addPending,
      resolvePending,
      reload: () => setNonce((n) => n + 1),
      resync: async () => {
        // Best-effort disk re-scan; even if it fails, refetch so the cache view is current.
        await api.refresh().catch(() => {})
        setNonce((n) => n + 1)
      },
    }),
    [projects, tasks, sessions, priorities, statuses, agents, loading, error, pending, addPending, resolvePending],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData must be used within DataProvider')
  return v
}
