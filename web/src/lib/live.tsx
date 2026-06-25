import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ShipStatus } from './types'
import { UNREAD_EPOCH_KEY, resolveShipStatus } from './unread'

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
  /** Batch markSeen for many ids at once (one localStorage write + one bump). Used on import so a
   *  freshly imported session defaults to READ — importing is an explicit acknowledgment, and a
   *  historical session that happens to post-date the unread-epoch baseline shouldn't surface as
   *  unread just because it was brought into Berth. */
  markSeenMany: (sessionIds: string[]) => void
  /** Explicitly flag a session as unread (→ dock) regardless of activity, so 标为未读 works for any
   *  row — including settled/old sessions not in the activity map. Cleared by markSeen / opening. */
  markUnread: (sessionId: string) => void
  shipStatus: (sessionId: string, fallbackUpdatedAt?: number) => ShipStatus
}

const Ctx = createContext<LiveState | null>(null)

const SEEN_KEY = 'berth-last-seen'
const UNREAD_KEY = 'berth-unread' // explicit "标为未读" overrides (session ids), independent of activity

function loadJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T
  } catch {
    return fallback
  }
}

function loadUnreadEpoch(): number {
  try {
    const existing = Number(localStorage.getItem(UNREAD_EPOCH_KEY) || 0)
    if (Number.isFinite(existing) && existing > 0) return existing
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem(UNREAD_EPOCH_KEY, String(now))
    return now
  } catch {
    return Math.floor(Date.now() / 1000)
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Map<string, Activity>>(new Map())
  const updatedAt = useRef(new Map<string, number>())
  const seen = useRef<Record<string, number>>(loadJson(SEEN_KEY, {}))
  const unread = useRef<Record<string, boolean>>(loadJson(UNREAD_KEY, {}))
  const unreadEpoch = useRef(loadUnreadEpoch())
  const [rev, setRev] = useState(0)
  const bump = () => setRev((n) => n + 1)

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
          if (m.updatedAt) updatedAt.current.set(m.sessionId, m.updatedAt)
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

  const value: LiveState = {
    activity,
    updatedAt: updatedAt.current,
    rev,
    markSeen: (sessionId) => {
      seen.current[sessionId] = Math.floor(Date.now() / 1000)
      if (unread.current[sessionId]) {
        delete unread.current[sessionId] // opening / reading clears an explicit unread flag
        try {
          localStorage.setItem(UNREAD_KEY, JSON.stringify(unread.current))
        } catch {
          /* ignore quota */
        }
      }
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen.current))
      } catch {
        /* ignore quota */
      }
      bump()
    },
    markSeenMany: (sessionIds) => {
      if (sessionIds.length === 0) return
      const now = Math.floor(Date.now() / 1000)
      let unreadChanged = false
      for (const id of sessionIds) {
        seen.current[id] = now
        if (unread.current[id]) { delete unread.current[id]; unreadChanged = true }
      }
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen.current))
        if (unreadChanged) localStorage.setItem(UNREAD_KEY, JSON.stringify(unread.current))
      } catch {
        /* ignore quota */
      }
      bump()
    },
    markUnread: (sessionId) => {
      unread.current[sessionId] = true
      try {
        localStorage.setItem(UNREAD_KEY, JSON.stringify(unread.current))
      } catch {
        /* ignore quota */
      }
      bump()
    },
    shipStatus: (sessionId, fallbackUpdatedAt) => {
      return resolveShipStatus({
        activity: activity.get(sessionId),
        explicitUnread: !!unread.current[sessionId],
        updatedAt: updatedAt.current.get(sessionId) ?? fallbackUpdatedAt,
        lastSeen: seen.current[sessionId],
        unreadEpoch: unreadEpoch.current,
      })
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLive(): LiveState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLive must be used within LiveProvider')
  return v
}
