import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { reconcileLaunchIntents } from '../src/server/reconcile'
import { filterImportedSessions, curatedSessionIds } from '../src/sessions'
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

  // Regression: refresh() must feed reconcile the UNFILTERED scan, not the import-filtered cache. A
  // fresh codex launch is bound=0 / unattached / not session-imported, and its cwd is no longer an
  // import root → it's filtered OUT of the cache. If reconcile got the filtered set it could never
  // find the session → never bind → never surface (a permanent deadlock).
  it('reconciles a fresh codex session that the import filter would exclude (must get the full scan)', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/unrooted', projectId: 'P', todoKey: null, sessionId: null, createdAt: 1000, bound: false })
    const all = [makeSession('fresh', '/unrooted', 1100)]
    s.upsertSessions(all)
    // refresh()'s real ordering: filter to import roots (none here) ∪ curated (none) → empty cache.
    const cache = filterImportedSessions(all, [] /* importRoots: no session_import_dir */, curatedSessionIds(s.allPinnedSet(), s.allAttachMap(), s.edgesByTodo().values(), s.allSessionImportSet(), s.allBoundLaunchSessionIds()))
    expect(cache.map(x => x.sessionId)).toEqual([]) // the fresh session is NOT in the cache

    // Passing the filtered cache would NOT bind (documents the bug):
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents().map(i => i.id)).toEqual(['i1'])

    // Passing the full scan binds it; next refresh's curated set then includes it via bound-launch.
    reconcileLaunchIntents(s, all)
    expect(s.pendingIntents()).toEqual([])
    expect(s.allBoundLaunchSessionIds().has('fresh')).toBe(true)
  })

  it('does not bind across cwd or to an already-bound session', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/proj', projectId: null, todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
    const cache = [makeSession('x', '/other', 1100)]
    s.upsertSessions(cache)
    reconcileLaunchIntents(s, cache)
    expect(s.pendingIntents().length).toBe(1)  // unmatched, still pending
  })

  it('binds codex intents when launch cwd and session cwd are path aliases', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'berth-reconcile-'))
    try {
      const real = join(tmp, 'real')
      const alias = join(tmp, 'alias')
      mkdirSync(real)
      symlinkSync(real, alias, 'dir')

      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: alias, projectId: 'P', todoKey: 'rec_A', sessionId: null, createdAt: 1000, bound: false })
      const cache = [makeSession('sess1', real, 1100)]
      s.upsertSessions(cache)
      reconcileLaunchIntents(s, cache)

      expect(s.pendingIntents()).toEqual([])
      expect(s.todoKeyForSession('sess1')).toBe('rec_A')
      expect(s.getAttach('sess1')).toMatchObject({ projectId: 'P', state: 'confirmed' })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
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
