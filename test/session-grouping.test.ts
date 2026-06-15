import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain browser ESM helper, no type decls
import { splitGroupRows } from '../public/session-grouping.js'

const DAY = 86400
const NOW = 1_000_000_000 // fixed reference "now" in epoch seconds

// helper: a session whose updatedAt is `daysAgo` days before NOW
const sess = (id: string, daysAgo: number) => ({ sessionId: id, updatedAt: NOW - daysAgo * DAY })

// ids in the returned order, for concise assertions
const ids = (rows: any[]) => rows.map(r => r.sessionId)

describe('splitGroupRows', () => {
  it('returns empty visible/stale for an empty group', () => {
    const { visible, stale } = splitGroupRows([], NOW)
    expect(visible).toEqual([])
    expect(stale).toEqual([])
  })

  it('shows everything when total <= minVisible (no Show more)', () => {
    const group = [sess('a', 10), sess('b', 20), sess('c', 30)] // all stale, total = 3
    const { visible, stale } = splitGroupRows(group, NOW)
    expect(visible).toHaveLength(3)
    expect(stale).toHaveLength(0)
  })

  it('keeps active sessions visible up to the default cap and hides stale ones (group C: 5 active + 4 stale)', () => {
    const group = [
      sess('a', 0), sess('b', 1), sess('c', 2), sess('d', 2.5), sess('e', 2.9), // active (<=3d)
      sess('s1', 4), sess('s2', 5), sess('s3', 6), sess('s4', 7),               // stale (>3d)
    ]
    const { visible, stale } = splitGroupRows(group, NOW)
    expect(ids(visible)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids(stale)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('caps visible rows at 6 even when more sessions are active', () => {
    const group = [
      sess('a', 0), sess('b', 0.5), sess('c', 1), sess('d', 1.5),
      sess('e', 2), sess('f', 2.5), sess('g', 2.9), // all active (<=3d)
      sess('s1', 4), sess('s2', 5),
    ]
    const { visible, stale } = splitGroupRows(group, NOW)
    expect(ids(visible)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(ids(stale)).toEqual(['g', 's1', 's2'])
  })

  it('fills up to minVisible with the most-recent stale when fewer than 3 are active (group A: 1 active + 9 stale)', () => {
    const group = [
      sess('act', 0),                                          // 1 active
      sess('s1', 4), sess('s2', 5), sess('s3', 6), sess('s4', 7),
      sess('s5', 8), sess('s6', 9), sess('s7', 10), sess('s8', 11), sess('s9', 12),
    ]
    const { visible, stale } = splitGroupRows(group, NOW)
    // active + the 2 newest stale = 3 visible
    expect(ids(visible)).toEqual(['act', 's1', 's2'])
    expect(stale).toHaveLength(7)
    expect(ids(stale)[0]).toBe('s3')
  })

  it('shows the 3 newest when the whole group is stale (group B: 0 active + 9 stale)', () => {
    const group = Array.from({ length: 9 }, (_, i) => sess('s' + i, 4 + i)) // all >3d, increasing age
    const { visible, stale } = splitGroupRows(group, NOW)
    expect(ids(visible)).toEqual(['s0', 's1', 's2'])
    expect(stale).toHaveLength(6)
  })

  it('sorts newest-first regardless of input order', () => {
    const group = [sess('old', 30), sess('new', 0), sess('mid', 10)]
    const { visible } = splitGroupRows(group, NOW)
    expect(ids(visible)).toEqual(['new', 'mid', 'old'])
  })

  it('treats exactly 3 days old as active, not stale (boundary)', () => {
    const group = [sess('edge', 3), sess('s1', 4), sess('s2', 5), sess('s3', 6)]
    const { visible } = splitGroupRows(group, NOW)
    // edge is active → still need min 3, so edge + 2 newest stale
    expect(ids(visible)).toEqual(['edge', 's1', 's2'])
  })

  it('honors custom staleDays / minVisible / maxVisible options', () => {
    const group = [sess('a', 0), sess('b', 2), sess('c', 5), sess('d', 8), sess('e', 9)]
    // staleDays=1 → only 'a' active; minVisible=2 → a + newest stale 'b'
    const { visible, stale } = splitGroupRows(group, NOW, { staleDays: 1, minVisible: 2, maxVisible: 4 })
    expect(ids(visible)).toEqual(['a', 'b'])
    expect(ids(stale)).toEqual(['c', 'd', 'e'])
  })
})
