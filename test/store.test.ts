import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { migrateSessionDirsOnce } from '../src/data/migrate-session-dirs'
import type { LogicalSession } from '../src/types'

const sess: LogicalSession = { sessionId:'s1', cli:'codex', cwd:'/c', title:'t', updatedAt: 5,
  contentSourcePath:'/c/s1.jsonl', resume:{cli:'codex',id:'s1'}, copies:[], deleted:false }

describe('store', () => {
  it('upserts sessions idempotently and persists attach + pin', () => {
    const db = openStore(':memory:')
    db.upsertSessions([sess]); db.upsertSessions([sess])
    expect(db.allSessions()).toHaveLength(1)
    db.setAttach('s1', 'projA', 'confirmed')
    db.setPin('s1', true)
    expect(db.getAttach('s1')).toEqual({ projectId:'projA', state:'confirmed' })
    expect(db.isPinned('s1')).toBe(true)
    db.setPin('s1', false); expect(db.isPinned('s1')).toBe(false)
  })
  it('attach survives a re-scan that re-upserts the same session (no triage reset)', () => {
    const db = openStore(':memory:')
    db.upsertSessions([sess]); db.setAttach('s1','projA','confirmed')
    db.upsertSessions([{ ...sess, updatedAt: 9 }])
    expect(db.getAttach('s1')).toEqual({ projectId:'projA', state:'confirmed' })
  })
})

describe('edges', () => {
  it('adds and reads task↔session edges', () => {
    const s = openStore(':memory:')
    s.addEdge('rec_A', 'sess_1'); s.addEdge('rec_A', 'sess_2'); s.addEdge('rec_B', 'sess_3')
    expect(s.edgesByTodo().get('rec_A')!.sort()).toEqual(['sess_1', 'sess_2'])
    expect(s.todoKeyForSession('sess_3')).toBe('rec_B')
    expect(s.todoKeyForSession('nope')).toBeNull()
  })
  it('addEdge is idempotent and removeEdgesForSession clears', () => {
    const s = openStore(':memory:')
    s.addEdge('rec_A', 'sess_1'); s.addEdge('rec_A', 'sess_1')
    expect(s.edgesByTodo().get('rec_A')).toEqual(['sess_1'])
    s.removeEdgesForSession('sess_1')
    expect(s.edgesByTodo().has('rec_A')).toBe(false)
  })
})

describe('project_path', () => {
  it('records paths, tracks the home, and a new home demotes the old', () => {
    const s = openStore(':memory:')
    s.addProjectPath('Berth', '/a', true)
    s.addProjectPath('Berth', '/b', false)
    let e = s.allProjectPaths().get('Berth')!
    expect(e.home).toBe('/a')
    expect(e.paths.sort()).toEqual(['/a', '/b'])
    // promote /b to home → /a demoted
    s.addProjectPath('Berth', '/b', true)
    e = s.allProjectPaths().get('Berth')!
    expect(e.home).toBe('/b')
    expect(e.paths.sort()).toEqual(['/a', '/b'])
  })
  it('adding the same path twice is idempotent', () => {
    const s = openStore(':memory:')
    s.addProjectPath('P', '/x', false)
    s.addProjectPath('P', '/x', false)
    expect(s.allProjectPaths().get('P')!.paths).toEqual(['/x'])
  })
  it('tracks per-path enabled (default on), toggle, and remove', () => {
    const s = openStore(':memory:')
    s.addProjectPath('P', '/x')          // default enabled
    s.addProjectPath('P', '/y', false, false) // registered, disabled
    const meta = () => Object.fromEntries(s.allProjectPaths().get('P')!.meta.map(m => [m.cwd, m.enabled]))
    expect(meta()).toEqual({ '/x': true, '/y': false })
    s.setPathEnabled('P', '/x', false)
    expect(meta()['/x']).toBe(false)
    s.removeProjectPath('P', '/y')
    expect(s.allProjectPaths().get('P')!.paths).toEqual(['/x'])
  })
})

describe('session_import (session-grained surfacing)', () => {
  it('CRUDs the explicit import set', () => {
    const s = openStore(':memory:')
    s.addSessionImport('a'); s.addSessionImport('b'); s.addSessionImport('a') // idempotent
    expect([...s.allSessionImportSet()].sort()).toEqual(['a', 'b'])
    s.removeSessionImport('a')
    expect([...s.allSessionImportSet()]).toEqual(['b'])
  })
  it('tracks hidden sessions, and re-importing unhides them', () => {
    const s = openStore(':memory:')
    s.hideSession('a')
    expect([...s.allHiddenSessionSet()]).toEqual(['a'])
    s.addSessionImport('a')
    expect([...s.allSessionImportSet()]).toEqual(['a'])
    expect([...s.allHiddenSessionSet()]).toEqual([])
  })
  it('exposes bound launch-intent session ids (per-session Berth-launch surfacing)', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/x', projectId: null, todoKey: null, sessionId: null, createdAt: 1, bound: false })
    s.addLaunchIntent({ id: 'i2', cli: 'claude', cwd: '/y', projectId: null, todoKey: null, sessionId: 'sess2', createdAt: 2, bound: true })
    s.bindIntent('i1', 'sess1')
    expect([...s.allBoundLaunchSessionIds()].sort()).toEqual(['sess1', 'sess2'])
  })
  it('removes launch intents by intent id or bound session id', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/x', projectId: null, todoKey: null, sessionId: null, createdAt: 1, bound: false })
    s.addLaunchIntent({ id: 'i2', cli: 'claude', cwd: '/y', projectId: null, todoKey: null, sessionId: 'sess2', createdAt: 2, bound: true })
    s.removeLaunchIntentsForSession('i1')
    s.removeLaunchIntentsForSession('sess2')
    expect(s.pendingIntents()).toEqual([])
    expect([...s.allBoundLaunchSessionIds()]).toEqual([])
  })
})

describe('soft foreign keys (§2.2)', () => {
  it('allows attaching/edging a session id not yet in logical_session (forward reference)', () => {
    const s = openStore(':memory:')
    // A freshly-launched session is attributed BEFORE the next refresh ingests it into logical_session.
    expect(() => s.setAttach('not-yet-indexed', 'projA', 'confirmed')).not.toThrow()
    expect(() => s.addEdge('rec_A', 'not-yet-indexed')).not.toThrow()
    expect(s.getAttach('not-yet-indexed')).toEqual({ projectId: 'projA', state: 'confirmed' })
    expect(s.todoKeyForSession('not-yet-indexed')).toBe('rec_A')
  })
})

describe('launch_intent', () => {
  it('stores pending intents and binds them', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/x', projectId: 'P', todoKey: 'rec_A', sessionId: null, createdAt: 100, bound: false })
    s.addLaunchIntent({ id: 'i2', cli: 'claude', cwd: '/y', projectId: null, todoKey: null, sessionId: 'uuid-2', createdAt: 101, bound: true })
    const pending = s.pendingIntents()
    expect(pending.map(i => i.id)).toEqual(['i1'])  // only unbound
    s.bindIntent('i1', 'sess_codex')
    expect(s.pendingIntents()).toEqual([])
  })
  it('exposes distinct launch-intent cwds as implicit import roots', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/x', projectId: null, todoKey: null, sessionId: null, createdAt: 1, bound: false })
    s.addLaunchIntent({ id: 'i2', cli: 'claude', cwd: '/x', projectId: null, todoKey: null, sessionId: 'u', createdAt: 2, bound: true })
    s.addLaunchIntent({ id: 'i3', cli: 'coco', cwd: '/y', projectId: null, todoKey: null, sessionId: null, createdAt: 3, bound: false })
    expect(s.allLaunchIntentCwds().sort()).toEqual(['/x', '/y'])
  })
  it('maps known session ids to their launch cwd (backfill source for grouping)', () => {
    const s = openStore(':memory:')
    // claude/coco intents carry the real sessionId + resolved cwd at launch; codex (sessionId null) does not yet.
    s.addLaunchIntent({ id: 'i1', cli: 'coco', cwd: '/ws/proj', projectId: 'proj', todoKey: null, sessionId: 'sess-coco', createdAt: 1, bound: true })
    s.addLaunchIntent({ id: 'i2', cli: 'codex', cwd: '/x', projectId: null, todoKey: null, sessionId: null, createdAt: 2, bound: false })
    const map = s.launchIntentCwdBySession()
    expect(map.get('sess-coco')).toBe('/ws/proj')
    expect(map.has('i2')).toBe(false)   // codex intent has no sessionId yet → not mapped
    expect(map.size).toBe(1)
  })
})

describe('session_import_dir', () => {
  it('adds, lists (sorted), and removes import directories idempotently', () => {
    const s = openStore(':memory:')
    s.addSessionImportDir('/b'); s.addSessionImportDir('/a'); s.addSessionImportDir('/a')
    expect(s.allSessionImportDirs()).toEqual(['/a', '/b'])
    s.removeSessionImportDir('/a')
    expect(s.allSessionImportDirs()).toEqual(['/b'])
  })

  it('stores import directories by real path and removes by either alias', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'berth-store-path-'))
    try {
      const real = join(tmp, 'real')
      const alias = join(tmp, 'alias')
      mkdirSync(real)
      symlinkSync(real, alias, 'dir')

      const s = openStore(':memory:')
      s.addSessionImportDir(alias)
      expect(s.allSessionImportDirs()).toEqual([realpathSync(real)])
      s.removeSessionImportDir(alias)
      expect(s.allSessionImportDirs()).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('migrateSessionDirsOnce', () => {
  it('backfills import dirs from attached sessions and runs only once', () => {
    const s = openStore(':memory:')
    s.upsertSessions([
      { sessionId: 'a', cli: 'claude', cwd: '/work/a', title: null, updatedAt: 1, contentSourcePath: null, copies: [], deleted: false },
      { sessionId: 'b', cli: 'claude', cwd: '/work/b', title: null, updatedAt: 1, contentSourcePath: null, copies: [], deleted: false },
      { sessionId: 'c', cli: 'claude', cwd: '/work/a', title: null, updatedAt: 1, contentSourcePath: null, copies: [], deleted: false },
    ])
    s.setAttach('a', 'P', 'confirmed')   // attached → its cwd is backfilled
    s.setAttach('c', 'P', 'confirmed')   // same cwd as 'a' → deduped
    // 'b' is unattached → not backfilled
    expect(migrateSessionDirsOnce(s)).toBe(1)
    expect(s.allSessionImportDirs()).toEqual(['/work/a'])
    expect(migrateSessionDirsOnce(s)).toBe(0)   // guarded: no-op on second run
  })

  it('seeds nothing on a fresh install (no attachments)', () => {
    const s = openStore(':memory:')
    expect(migrateSessionDirsOnce(s)).toBe(0)
    expect(s.allSessionImportDirs()).toEqual([])
  })
})

describe('read-state', () => {
  it('markSeen upserts max(last_seen) and resets explicit_unread', () => {
    const db = openStore(':memory:')
    db.markUnread('s1')                       // explicit unread first
    db.markSeen(['s1'], 100)                  // seeing clears it + sets last_seen
    db.markSeen(['s1'], 50)                   // older ts must not lower last_seen
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)
    expect(st.unread['s1']).toBeUndefined()
  })

  it('markUnread sets the flag and preserves last_seen', () => {
    const db = openStore(':memory:')
    db.markSeen(['s1'], 100)
    db.markUnread('s1')
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)
    expect(st.unread['s1']).toBe(true)
  })

  it('readState lazily defaults the epoch and persists it', () => {
    const db = openStore(':memory:')
    const first = db.readState().epoch
    expect(first).toBeGreaterThan(0)
    expect(db.readState().epoch).toBe(first)  // stable across calls
  })

  it('importReadState merges max last_seen, OR unread, min epoch', () => {
    const db = openStore(':memory:')
    db.markSeen(['s1'], 100)
    db.readState()                            // forces a server epoch (now, large)
    db.importReadState({ seen: { s1: 50, s2: 200 }, unread: { s3: true }, epoch: 42 })
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)       // max(100, 50)
    expect(st.lastSeen['s2']).toBe(200)
    expect(st.unread['s3']).toBe(true)
    expect(st.epoch).toBe(42)                 // min(now, 42)
  })

  it('importReadState adopts the incoming epoch when none exists yet', () => {
    const db = openStore(':memory:')
    db.importReadState({ epoch: 42 })   // no prior readState() → no stored epoch
    expect(db.readState().epoch).toBe(42)
  })
})
