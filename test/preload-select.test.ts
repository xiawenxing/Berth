import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain browser ESM helper, no type decls
import { selectPreloadSessions } from '../public/preload-select.js'

const DAY = 86400
const NOW = 1_000_000_000 // fixed reference "now" in epoch seconds
const EPOCH = NOW - 30 * DAY // unread baseline: activity after this counts as unread

// helper: a session `daysAgo` days old, optionally pinned
const sess = (id: string, daysAgo: number, extra: any = {}) => ({
  sessionId: id,
  updatedAt: NOW - daysAgo * DAY,
  pinned: false,
  ...extra,
})

describe('selectPreloadSessions', () => {
  it('returns [] for no sessions', () => {
    expect(selectPreloadSessions([], {}, EPOCH, 5)).toEqual([])
  })

  it('orders pinned first, then unread, then recent', () => {
    const sessions = [
      sess('recent-new', 0),                 // recent (not pinned, read: updatedAt < seen)
      sess('pinned-old', 20, { pinned: true }),
      sess('unread-mid', 1),                 // unread (after epoch, not seen)
    ]
    // mark recent-new as already seen so it's "recent" not "unread"
    const seen = { 'recent-new': NOW } // seen >= updatedAt → read
    const out = selectPreloadSessions(sessions, seen, EPOCH, 5)
    expect(out).toEqual(['pinned-old', 'unread-mid', 'recent-new'])
  })

  it('orders by updatedAt desc within each tier', () => {
    const sessions = [
      sess('p-older', 10, { pinned: true }),
      sess('p-newer', 2, { pinned: true }),
    ]
    expect(selectPreloadSessions(sessions, {}, EPOCH, 5)).toEqual(['p-newer', 'p-older'])
  })

  it('dedups a session that qualifies for multiple tiers (keeps highest tier, once)', () => {
    // pinned AND unread → appears once, in the pinned tier
    const sessions = [
      sess('both', 1, { pinned: true }),
      sess('plain-unread', 0),
    ]
    const out = selectPreloadSessions(sessions, {}, EPOCH, 5)
    expect(out).toEqual(['both', 'plain-unread'])
    expect(out.filter((x: string) => x === 'both')).toHaveLength(1)
  })

  it('a session is unread only when updatedAt is after epoch AND after lastSeen', () => {
    const sessions = [
      sess('stale', 40),                 // before epoch → not unread, just recent
      sess('seen-after', 1),             // after epoch but already seen → not unread
      sess('genuinely-unread', 2),       // after epoch, not seen → unread
    ]
    const seen = { 'seen-after': NOW }
    const out = selectPreloadSessions(sessions, seen, EPOCH, 5)
    // unread tier (genuinely-unread) before recent tier (seen-after newer, then stale)
    expect(out).toEqual(['genuinely-unread', 'seen-after', 'stale'])
  })

  it('caps at n', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => sess(`s${i}`, i + 1))
    expect(selectPreloadSessions(sessions, {}, EPOCH, 5)).toHaveLength(5)
  })

  it('defaults n to 5', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => sess(`s${i}`, i + 1))
    expect(selectPreloadSessions(sessions, {}, EPOCH)).toHaveLength(5)
  })

  it('returns fewer than n when there are fewer sessions', () => {
    const sessions = [sess('a', 1), sess('b', 2)]
    expect(selectPreloadSessions(sessions, {}, EPOCH, 5)).toEqual(['a', 'b'])
  })
})
