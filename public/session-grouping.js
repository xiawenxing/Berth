// Pure helper for sidebar session-list row truncation.
//
// Within a project/dir group, sessions inactive for more than `staleDays` days
// are tucked away behind a "Show more" control. We always keep at least
// `minVisible` rows on screen, filling with the most-recent stale sessions when
// there aren't enough active ones, and cap the expanded-by-recency visible set
// at `maxVisible` so very active groups do not dominate the sidebar.
//
// Loaded both in the browser (as an ES module, exposed on window via index.html)
// and in vitest (imported directly) — so keep it DOM-free and side-effect-free.

const DAY_SECONDS = 86400

/**
 * Split a group's sessions into visible rows and stale (hidden) rows.
 *
 * @param {Array<{updatedAt:number}>} sessions  sessions in the group (any order)
 * @param {number} nowSec                        current time, epoch seconds
 * @param {{staleDays?:number, minVisible?:number, maxVisible?:number}} [opts]
 * @returns {{visible:Array, stale:Array}} both arrays sorted newest-first; `stale` is the hidden overflow bucket
 */
export function splitGroupRows(sessions, nowSec, opts = {}) {
  const staleDays = opts.staleDays ?? 3
  const minVisible = opts.minVisible ?? 3
  const maxVisible = opts.maxVisible ?? 6
  const cutoff = nowSec - staleDays * DAY_SECONDS

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const activeCount = sorted.filter(s => s.updatedAt >= cutoff).length
  // Keep active rows within the visible cap, but never fewer than minVisible
  // (both bounds are capped at group size).
  const visibleCount = Math.min(Math.max(activeCount, minVisible), maxVisible, sorted.length)

  return { visible: sorted.slice(0, visibleCount), stale: sorted.slice(visibleCount) }
}
