import type { ApiSession } from './api'

/**
 * The rail's Pin section: every pinned session, in the order the user pinned them (oldest first) so
 * rows never jump around as sessions get new activity — muscle memory is the point of a quick-access
 * list. Rows without a server-side order (an optimistic pin, or an older server) sort after the
 * ordered ones, newest activity first.
 */
export function pinnedSessions(sessions: ApiSession[]): ApiSession[] {
  return sessions
    .filter((s) => s.pinned)
    .sort((a, b) => {
      const ao = a.pinOrder ?? Number.POSITIVE_INFINITY
      const bo = b.pinOrder ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return b.updatedAt - a.updatedAt
    })
}

/** Optimistically apply a pin toggle: a new pin goes to the end of the order, an unpin clears it. */
export function applyPin(sessions: ApiSession[], sessionId: string, on: boolean): ApiSession[] {
  const target = sessions.find((s) => s.sessionId === sessionId)
  if (!target || !!target.pinned === on) return sessions
  const nextOrder = on
    ? sessions.reduce((max, s) => (s.pinned && s.pinOrder != null ? Math.max(max, s.pinOrder) : max), -1) + 1
    : null
  return sessions.map((s) => (s.sessionId === sessionId ? { ...s, pinned: on, pinOrder: nextOrder } : s))
}
