import { describe, it, expect } from 'vitest'
import { selectOrphanLaunches, selectExpiredUnboundIntents } from '../src/server/orphan-sweep'

const base = { id: 'i', sessionId: 's', createdAt: 1000 }
const opts = (over = {}) => ({ nowSec: 2000, graceSec: 300, hasLivePty: () => false, sessionExists: () => false, ...over })

describe('selectOrphanLaunches', () => {
  it('selects a bound launch with dead pty, no jsonl, older than grace', () => {
    expect(selectOrphanLaunches([base], opts())).toEqual(['i'])
  })
  it('keeps it if the pty is still alive', () => {
    expect(selectOrphanLaunches([base], opts({ hasLivePty: () => true }))).toEqual([])
  })
  it('keeps it if the session exists on disk', () => {
    expect(selectOrphanLaunches([base], opts({ sessionExists: () => true }))).toEqual([])
  })
  it('keeps it inside the grace window (still booting)', () => {
    expect(selectOrphanLaunches([base], opts({ nowSec: 1100 }))).toEqual([])
  })
  it('skips intents with no sessionId (codex pre-bind)', () => {
    expect(selectOrphanLaunches([{ id: 'i', sessionId: null, createdAt: 1000 }], opts())).toEqual([])
  })
})

describe('selectExpiredUnboundIntents', () => {
  const pi = (over = {}) => ({ id: 'i', cli: 'codex', sessionId: null, createdAt: 1000, ...over })
  const o = (over = {}) => ({ nowSec: 2000, ttlSec: 600, hasLivePty: () => false, ...over })

  it('drops a codex unbound intent older than TTL whose pty is gone', () => {
    expect(selectExpiredUnboundIntents([pi()], o())).toEqual(['i'])
  })
  it('keeps it while the pty is still alive (codex may yet write session_meta)', () => {
    expect(selectExpiredUnboundIntents([pi()], o({ hasLivePty: (k: string) => k === 'i' }))).toEqual([])
  })
  it('keeps it inside the TTL window', () => {
    expect(selectExpiredUnboundIntents([pi()], o({ nowSec: 1100 }))).toEqual([])
  })
  it('never drops a bound codex intent (sessionId set)', () => {
    expect(selectExpiredUnboundIntents([pi({ sessionId: 'real' })], o())).toEqual([])
  })
  it('ignores non-codex intents', () => {
    expect(selectExpiredUnboundIntents([pi({ cli: 'claude' })], o())).toEqual([])
  })
})
