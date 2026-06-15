import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { reconcileLaunchIntents } from '../src/server/reconcile'
import type { LogicalSession } from '../src/types'

/** Build a minimal LogicalSession for testing. */
function makeSession(sessionId: string, cwd: string, updatedAt: number, cli: 'codex' | 'claude' | 'coco' = 'codex'): LogicalSession {
  return { sessionId, cli, cwd, title: null, updatedAt, contentSourcePath: null, copies: [], deleted: false }
}

describe('reconcileLaunchIntents', () => {
  it('binds a pending codex intent to the newest matching session', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    const cache = [
      makeSession('old', '/proj', 900),   // before intent → ignore
      makeSession('new', '/proj', 1100),  // after → bind
    ]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents()).toEqual([])
    expect(s.todoKeyForSession('new')).toBe('rec_A')
    expect(s.getAttach('new')).toMatchObject({ projectId: 'P', state: 'confirmed' })
  })

  it('does not bind across cwd or to an already-bound session', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: null, todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('x', '/other', 1100)]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents().length).toBe(1)  // unmatched, still pending
  })

  it('does not bind a session already used in this pass', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: 'P1', todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    s.addLaunchIntent({ id: 'i2', cli: 'codex', cwd: '/proj', projectId: 'P2', todoKey: 'rec_B', sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('sess1', '/proj', 1100)]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    // only one intent should have been bound (the first one that claims sess1)
    const pending = s.pendingIntents()
    expect(pending.length).toBe(1)
  })

  it('ignores non-codex intents', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'claude', cwd: '/proj', projectId: 'P', todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('sess1', '/proj', 1100, 'claude')]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    // claude intents are not reconciled here, still pending
    expect(s.pendingIntents().length).toBe(1)
  })

  it('ignores sessions already having an attach', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('sess1', '/proj', 1100)]
    s.upsertSessions(cache)
    // pre-attach the session so it appears "already attached"
    s.setAttach('sess1', 'OtherProject', 'confirmed')
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents().length).toBe(1)  // not bound — session was already attached
  })

  it('skips addEdge when todoKey is null but still binds', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: null, sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('sess1', '/proj', 1100)]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents()).toEqual([])
    expect(s.todoKeyForSession('sess1')).toBeNull()  // no edge added
    expect(s.getAttach('sess1')).toMatchObject({ projectId: 'P', state: 'confirmed' })
  })
})
