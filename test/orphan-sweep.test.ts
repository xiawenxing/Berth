import { describe, it, expect } from 'vitest'
import { selectOrphanLaunches } from '../src/server/orphan-sweep'

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
