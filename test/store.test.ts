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
