import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ShipStatus } from './types'

// Live per-session activity from the /status WS (running / settled), plus a local
// lastSeen map. Ship status: running→在航(sail); settled & newer than lastSeen→靠岸·待查收(dock);
// otherwise 已停泊(moored).

type Activity = 'running' | 'settled'

interface LiveState {
  activity: Map<string, Activity>
  /** newest real-message time per settled session (for the unread/dock decision) */
  updatedAt: Map<string, number>
  markSeen: (sessionId: string) => void
  shipStatus: (sessionId: string, fallbackUpdatedAt?: number) => ShipStatus
}

const Ctx = createContext<LiveState | null>(null)

const SEEN_KEY = 'berth-last-seen'
function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
  } catch {
    return {}
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Map<string, Activity>>(new Map())
  const updatedAt = useRef(new Map<string, number>())
  const seen = useRef<Record<string, number>>(loadSeen())
  const [, force] = useState(0)

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
        } else if (m.t === 'act') {
          setActivity((prev) => {
            const next = new Map(prev)
            if (m.state === 'exited') next.delete(m.sessionId)
            else next.set(m.sessionId, m.state)
            return next
          })
          if (m.updatedAt) updatedAt.current.set(m.sessionId, m.updatedAt)
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
    markSeen: (sessionId) => {
      seen.current[sessionId] = Math.floor(Date.now() / 1000)
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen.current))
      } catch {
        /* ignore quota */
      }
      force((n) => n + 1)
    },
    shipStatus: (sessionId, fallbackUpdatedAt) => {
      const a = activity.get(sessionId)
      if (a === 'running') return 'sail'
      const u = updatedAt.current.get(sessionId) ?? fallbackUpdatedAt ?? 0
      const s = seen.current[sessionId] ?? 0
      if (a === 'settled' && u > s) return 'dock'
      return 'moored'
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLive(): LiveState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLive must be used within LiveProvider')
  return v
}
