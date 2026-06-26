import { describe, it, expect } from 'vitest'
import { selectWarmSessions, createWarmPool, resolveWarmPoolSize, type WarmCandidate } from '../src/server/warm-pool'

const cand = (p: Partial<WarmCandidate> & { sessionId: string }): WarmCandidate => ({
  sessionId: p.sessionId,
  pinned: p.pinned ?? false,
  running: p.running ?? false,
  updatedAt: p.updatedAt ?? 0,
  resumable: p.resumable ?? true,
  deleted: p.deleted ?? false,
  live: p.live ?? false,
})

describe('selectWarmSessions', () => {
  it('orders pinned first, then running, then recent (updatedAt desc)', () => {
    const out = selectWarmSessions([
      cand({ sessionId: 'recent-old', updatedAt: 10 }),
      cand({ sessionId: 'running', running: true, updatedAt: 5 }),
      cand({ sessionId: 'pinned', pinned: true, updatedAt: 1 }),
      cand({ sessionId: 'recent-new', updatedAt: 20 }),
    ], 10)
    expect(out).toEqual(['pinned', 'running', 'recent-new', 'recent-old'])
  })

  it('skips deleted, non-resumable, and already-live sessions', () => {
    const out = selectWarmSessions([
      cand({ sessionId: 'ok', updatedAt: 3 }),
      cand({ sessionId: 'gone', deleted: true, updatedAt: 99 }),
      cand({ sessionId: 'no-resume', resumable: false, updatedAt: 99 }),
      cand({ sessionId: 'already-live', live: true, updatedAt: 99 }),
    ], 10)
    expect(out).toEqual(['ok'])
  })

  it('takes at most k', () => {
    const cands = [1, 2, 3, 4, 5].map(n => cand({ sessionId: `s${n}`, updatedAt: n }))
    expect(selectWarmSessions(cands, 2)).toEqual(['s5', 's4'])
  })

  it('returns empty for k <= 0', () => {
    expect(selectWarmSessions([cand({ sessionId: 'a' })], 0)).toEqual([])
    expect(selectWarmSessions([cand({ sessionId: 'a' })], -3)).toEqual([])
  })

  it('returns fewer than k when few qualify', () => {
    expect(selectWarmSessions([cand({ sessionId: 'a' })], 6)).toEqual(['a'])
  })
})

describe('createWarmPool', () => {
  it('evicts the oldest warm entry (and kills it) past the cap', () => {
    const killed: string[] = []
    const pool = createWarmPool({ cap: 2, kill: id => killed.push(id) })
    pool.add('a'); pool.add('b')
    expect(killed).toEqual([])
    pool.add('c')   // over cap → evict oldest (a)
    expect(killed).toEqual(['a'])
    expect(pool.has('a')).toBe(false)
    expect(pool.has('b')).toBe(true)
    expect(pool.has('c')).toBe(true)
    expect(pool.size()).toBe(2)
  })

  it('markOpened graduates a session so it is no longer counted or evictable', () => {
    const killed: string[] = []
    const pool = createWarmPool({ cap: 2, kill: id => killed.push(id) })
    pool.add('a'); pool.add('b')
    pool.markOpened('a')          // user opened 'a' → leaves the pool
    expect(pool.size()).toBe(1)
    pool.add('c')                 // now under cap again → no eviction
    expect(killed).toEqual([])
    expect(pool.has('b')).toBe(true)
    expect(pool.has('c')).toBe(true)
  })

  it('noteExited drops a session that exited on its own', () => {
    const pool = createWarmPool({ cap: 3, kill: () => {} })
    pool.add('a'); pool.add('b')
    pool.noteExited('a')
    expect(pool.has('a')).toBe(false)
    expect(pool.size()).toBe(1)
  })

  it('never evicts a graduated (opened) session', () => {
    const killed: string[] = []
    const pool = createWarmPool({ cap: 1, kill: id => killed.push(id) })
    pool.add('a')
    pool.markOpened('a')   // graduated, no longer in pool
    pool.add('b')          // pool now {b}, under cap
    expect(killed).toEqual([])
    expect(pool.has('b')).toBe(true)
  })
})

describe('resolveWarmPoolSize', () => {
  it('defaults to 6 when neither env nor stored value is set', () => {
    expect(resolveWarmPoolSize(undefined, null)).toBe(6)
  })

  it('uses the stored setting when valid', () => {
    expect(resolveWarmPoolSize(undefined, '10')).toBe(10)
    expect(resolveWarmPoolSize(undefined, '0')).toBe(0)
  })

  it('lets the env override win over the stored setting', () => {
    expect(resolveWarmPoolSize('3', '10')).toBe(3)
    expect(resolveWarmPoolSize('0', '10')).toBe(0)
  })

  it('falls back when values are invalid (non-int, negative, empty)', () => {
    expect(resolveWarmPoolSize('', '10')).toBe(10)   // empty env ignored, stored wins
    expect(resolveWarmPoolSize('abc', null)).toBe(6)
    expect(resolveWarmPoolSize(undefined, '-2')).toBe(6)
    expect(resolveWarmPoolSize(undefined, '2.5')).toBe(6)
  })
})
