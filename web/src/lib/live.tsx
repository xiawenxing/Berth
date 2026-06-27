import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ShipStatus } from './types'
import { UNREAD_EPOCH_KEY, resolveShipStatus } from './unread'
import { api } from './api'

// Live per-session activity from the /status WS (running / settled), plus a local
// lastSeen map. Ship status: running→在航(sail); settled & newer than lastSeen→靠岸·待查收(dock);
// otherwise 已停泊(moored).

export type Activity = 'running' | 'settled'

export interface LiveState {
  activity: Map<string, Activity>
  /** newest real-message time per settled session (for the unread/dock decision) */
  updatedAt: Map<string, number>
  /** bumps whenever ANY ship-status input changes (activity / updatedAt / seen). Memoized
   *  derivations of shipStatus must depend on this, not on `activity` — updatedAt & seen are
   *  ref-backed and don't change `activity`'s reference, so they'd otherwise go stale. */
  rev: number
  markSeen: (sessionId: string) => void
  /** Batch markSeen for many ids at once (one server POST + one bump). Used on import so a
   *  freshly imported session defaults to READ — importing is an explicit acknowledgment, and a
   *  historical session that happens to post-date the unread-epoch baseline shouldn't surface as
   *  unread just because it was brought into Berth. */
  markSeenMany: (sessionIds: string[]) => void
  /** Explicitly flag a session as unread (→ dock) regardless of activity, so 标为未读 works for any
   *  row — including settled/old sessions not in the activity map. Cleared by markSeen / opening. */
  markUnread: (sessionId: string) => void
  /** Register the session currently open in the drawer (or null). While a session is active, output
   *  that lands on it keeps its lastSeen in sync so it doesn't surface as unread under the user's nose. */
  setActiveSession: (sessionId: string | null) => void
  shipStatus: (sessionId: string, fallbackUpdatedAt?: number) => ShipStatus
}

/** The mutation half of LiveState — markSeen/markUnread/etc. These are ref-backed and have a STABLE
 *  identity across activity bumps, so a component that needs only to ACT (e.g. a session-list row's
 *  标为已读/未读) can subscribe to them without re-rendering on every /status frame. (React.memo can't
 *  shield a component that subscribes to a context whose value changes each render, so the actions get
 *  their own context — see useLiveActions.) */
export type LiveActions = Pick<LiveState, 'markSeen' | 'markSeenMany' | 'markUnread' | 'setActiveSession'>

const Ctx = createContext<LiveState | null>(null)
const ActionsCtx = createContext<LiveActions | null>(null)

const SEEN_KEY = 'berth-last-seen'
const UNREAD_KEY = 'berth-unread' // explicit "标为未读" overrides (session ids), independent of activity
const MIGRATED_KEY = 'berth-read-migrated'

// One-time, per-origin: push any legacy localStorage read-state up to the server, then never again.
// Returns once the import POST (if any) has been attempted.
async function migrateLegacyReadState(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return
    const seen = loadJson<Record<string, number>>(SEEN_KEY, {})
    const unread = loadJson<Record<string, true>>(UNREAD_KEY, {})
    const epochRaw = Number(localStorage.getItem(UNREAD_EPOCH_KEY) || 0)
    const epoch = Number.isFinite(epochRaw) && epochRaw > 0 ? epochRaw : undefined
    const hasLegacy = Object.keys(seen).length > 0 || Object.keys(unread).length > 0 || epoch !== undefined
    if (hasLegacy) await api.importReadState({ seen, unread, epoch })
    localStorage.setItem(MIGRATED_KEY, '1')
  } catch { /* best-effort: a failed migration just retries on the next load */ }
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T
  } catch {
    return fallback
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Map<string, Activity>>(new Map())
  const updatedAt = useRef(new Map<string, number>())
  const seen = useRef<Record<string, number>>({})
  const unread = useRef<Record<string, boolean>>({})
  const unreadEpoch = useRef(Math.floor(Date.now() / 1000))
  const activeSession = useRef<string | null>(null)
  // Session ids the user has acted on locally this mount. The mount-time server hydration must not
  // clobber these — a mutation can land before the initial GET resolves, and its in-flight POST,
  // not the pre-POST server snapshot, is the truth.
  const touched = useRef(new Set<string>())
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((n) => n + 1), [])
  // Stable so the drawer can register/clear the active session from an effect without re-firing it.
  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSession.current = sessionId
  }, [])

  // Seed read-state from the server (migrating any legacy localStorage first). Server is the source
  // of truth now — origin-independent, so the CLI browser and the Electron app share unread markers.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await migrateLegacyReadState()
      try {
        const st = await api.readState()
        if (cancelled) return
        for (const [k, v] of Object.entries(st.lastSeen)) {
          if (!touched.current.has(k)) seen.current[k] = v
        }
        for (const k of Object.keys(st.unread)) {
          if (!touched.current.has(k)) unread.current[k] = true
        }
        unreadEpoch.current = st.epoch
        bump()
      } catch { /* offline / failed GET → leave refs empty (everything moored); reload re-fetches */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket | null = null
    let stop = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      ws = new WebSocket(`${proto}://${location.host}/status`)
      ws.onmessage = (e) => {
        let m: any
        try {
          m = JSON.parse(e.data)
        } catch {
          return
        }
        if (m.t === 'snap') {
          setActivity(new Map((m.sessions ?? []).map((s: any) => [s.sessionId, s.state])))
          bump()
        } else if (m.t === 'act') {
          setActivity((prev) => {
            const next = new Map(prev)
            if (m.state === 'exited') next.delete(m.sessionId)
            else next.set(m.sessionId, m.state)
            return next
          })
          if (m.updatedAt) {
            updatedAt.current.set(m.sessionId, m.updatedAt)
            // If this session is open in the drawer, the user is looking at this very output — keep
            // its lastSeen in sync so it doesn't flip to unread (dock) under them. We touch only
            // lastSeen, not the explicit 标为未读 flag, so a manual mark-unread on the open session
            // still sticks.
            if (activeSession.current === m.sessionId) {
              touched.current.add(m.sessionId)
              const next = Math.max(seen.current[m.sessionId] ?? 0, m.updatedAt)
              seen.current[m.sessionId] = next
              void api.markSeen([m.sessionId], next).catch(() => {})
            }
          }
          bump()
        } else if (m.t === 'rekey') {
          setActivity((prev) => {
            const next = new Map(prev)
            const v = next.get(m.from)
            if (v) {
              next.delete(m.from)
              next.set(m.to, v)
            }
            return next
          })
          window.dispatchEvent(new CustomEvent('berth:session-rekey', { detail: { from: m.from, to: m.to } }))
          bump()
        }
      }
      ws.onclose = () => {
        if (!stop) retryTimer = setTimeout(connect, 1500) // reconnect
      }
    }
    connect()
    return () => {
      stop = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  const markSeen = useCallback((sessionId: string) => {
    touched.current.add(sessionId)
    const now = Math.floor(Date.now() / 1000)
    seen.current[sessionId] = now
    if (unread.current[sessionId]) delete unread.current[sessionId]
    void api.markSeen([sessionId], now).catch(() => {})
    bump()
  }, [bump])
  const markSeenMany = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    for (const id of sessionIds) {
      touched.current.add(id)
      seen.current[id] = now
      if (unread.current[id]) delete unread.current[id]
    }
    void api.markSeen(sessionIds, now).catch(() => {})
    bump()
  }, [bump])
  const markUnread = useCallback((sessionId: string) => {
    touched.current.add(sessionId)
    unread.current[sessionId] = true
    void api.markUnread(sessionId).catch(() => {})
    bump()
  }, [bump])

  // Stable across bumps — every dep is itself stable (useCallback). Row subscribes to THIS, so a
  // /status frame that bumps `rev` no longer re-renders the whole session list, only the rows whose
  // own data actually changed (see SessionModule's memoized Row).
  const actions = useMemo<LiveActions>(
    () => ({ markSeen, markSeenMany, markUnread, setActiveSession }),
    [markSeen, markSeenMany, markUnread, setActiveSession],
  )

  // The volatile half: changes each bump (rev / activity), so status-deriving consumers re-read.
  const value = useMemo<LiveState>(
    () => ({
      activity,
      updatedAt: updatedAt.current,
      rev,
      ...actions,
      shipStatus: (sessionId, fallbackUpdatedAt) =>
        resolveShipStatus({
          activity: activity.get(sessionId),
          explicitUnread: !!unread.current[sessionId],
          updatedAt: updatedAt.current.get(sessionId) ?? fallbackUpdatedAt,
          lastSeen: seen.current[sessionId],
          unreadEpoch: unreadEpoch.current,
        }),
    }),
    [activity, rev, actions],
  )
  return (
    <ActionsCtx.Provider value={actions}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ActionsCtx.Provider>
  )
}

export function useLive(): LiveState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLive must be used within LiveProvider')
  return v
}

/** Subscribe ONLY to the stable mutation actions (markSeen/markUnread/…). Unlike useLive, this does
 *  NOT re-render its consumer when activity/rev bumps — use it in hot list rows that only need to act. */
export function useLiveActions(): LiveActions {
  const v = useContext(ActionsCtx)
  if (!v) throw new Error('useLiveActions must be used within LiveProvider')
  return v
}
