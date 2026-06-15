// Pure helper: pick which sessions to preload/warm on startup.
// Priority tiers: pinned → unread → recent (each by updatedAt desc), deduped, capped to n.
// Exposed on window for app.js (classic script) via an inline module import in index.html,
// and unit-tested directly (test/preload-select.test.ts). Keep it side-effect free.

/**
 * @param {Array<{sessionId:string, updatedAt:number, pinned?:boolean}>} sessions
 * @param {Record<string, number>} seen   sessionId → last-seen epoch seconds
 * @param {number} unreadEpoch            activity after this counts toward "unread"
 * @param {number} [n=5]                  max ids to return
 * @returns {string[]} ordered sessionIds
 */
export function selectPreloadSessions(sessions, seen = {}, unreadEpoch = 0, n = 5) {
  const isUnread = s =>
    s.updatedAt > unreadEpoch && s.updatedAt > ((seen && seen[s.sessionId]) || 0)

  const byRecency = (a, b) => b.updatedAt - a.updatedAt
  const pinned = sessions.filter(s => s.pinned).sort(byRecency)
  const unread = sessions.filter(s => !s.pinned && isUnread(s)).sort(byRecency)
  const recent = sessions.filter(s => !s.pinned && !isUnread(s)).sort(byRecency)

  const out = []
  const taken = new Set()
  for (const s of [...pinned, ...unread, ...recent]) {
    if (taken.has(s.sessionId)) continue
    taken.add(s.sessionId)
    out.push(s.sessionId)
    if (out.length >= n) break
  }
  return out
}
