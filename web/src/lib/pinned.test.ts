import { describe, it, expect } from 'vitest'
import { applyPin, pinnedSessions } from './pinned'
import type { ApiSession } from './api'

const s = (sessionId: string, extra: Partial<ApiSession> = {}): ApiSession => ({ sessionId, cli: 'claude', updatedAt: 0, ...extra })

describe('pinnedSessions', () => {
  it('keeps only pinned sessions, in pin order regardless of activity', () => {
    const list = [
      s('a', { pinned: true, pinOrder: 2, updatedAt: 300 }),
      s('b', { updatedAt: 999 }),
      s('c', { pinned: true, pinOrder: 0, updatedAt: 100 }),
      s('d', { pinned: true, pinOrder: 1, updatedAt: 200 }),
    ]
    expect(pinnedSessions(list).map((x) => x.sessionId)).toEqual(['c', 'd', 'a'])
  })

  it('puts pins without an order after ordered ones, newest first', () => {
    const list = [
      s('old', { pinned: true, updatedAt: 1 }),
      s('ordered', { pinned: true, pinOrder: 0, updatedAt: 0 }),
      s('new', { pinned: true, pinOrder: null, updatedAt: 5 }),
    ]
    expect(pinnedSessions(list).map((x) => x.sessionId)).toEqual(['ordered', 'new', 'old'])
  })
})

describe('applyPin', () => {
  it('appends a new pin after the current last one', () => {
    const list = [s('a', { pinned: true, pinOrder: 0 }), s('b', { pinned: true, pinOrder: 3 }), s('c')]
    const next = applyPin(list, 'c', true)
    expect(next.find((x) => x.sessionId === 'c')).toMatchObject({ pinned: true, pinOrder: 4 })
    expect(pinnedSessions(next).map((x) => x.sessionId)).toEqual(['a', 'b', 'c'])
  })

  it('clears the order on unpin', () => {
    const next = applyPin([s('a', { pinned: true, pinOrder: 0 })], 'a', false)
    expect(next[0]).toMatchObject({ pinned: false, pinOrder: null })
  })

  it('is a no-op for an unknown id or an unchanged state', () => {
    const list = [s('a', { pinned: true, pinOrder: 0 })]
    expect(applyPin(list, 'zzz', true)).toBe(list)
    expect(applyPin(list, 'a', true)).toBe(list)
  })
})
