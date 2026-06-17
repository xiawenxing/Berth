import Database from 'better-sqlite3'
import type { LogicalSession, LaunchIntent } from '../types'
import { DATA_SCHEMA, dataMethods, migrateDataSchema } from '../data/store-data'
import { canonicalPathKey } from '../path-normalize'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS logical_session (
  session_id TEXT PRIMARY KEY, cli TEXT NOT NULL, cwd TEXT, title TEXT,
  updated_at INTEGER NOT NULL, content_source_path TEXT, resume_cli TEXT, resume_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
-- populated in a later phase (copy-tracking / todo-edge); upsertSessions intentionally does not write these
CREATE TABLE IF NOT EXISTS physical_copy (
  store_path TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES logical_session(session_id),
  cli TEXT NOT NULL, kind TEXT NOT NULL, physical_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attach (
  session_id TEXT PRIMARY KEY REFERENCES logical_session(session_id),
  project_id TEXT, state TEXT NOT NULL DEFAULT 'unconfirmed'
);
CREATE TABLE IF NOT EXISTS pin ( session_id TEXT PRIMARY KEY REFERENCES logical_session(session_id) );
CREATE TABLE IF NOT EXISTS title_override (session_id TEXT PRIMARY KEY, title TEXT NOT NULL);
-- populated in a later phase (copy-tracking / todo-edge); upsertSessions intentionally does not write these
CREATE TABLE IF NOT EXISTS edge (
  todo_key TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY (todo_key, session_id)
);
CREATE TABLE IF NOT EXISTS launch_intent (
  id TEXT PRIMARY KEY, cli TEXT NOT NULL, cwd TEXT NOT NULL,
  project_id TEXT, todo_key TEXT, session_id TEXT,
  created_at INTEGER NOT NULL, bound INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS archived_project ( project_id TEXT PRIMARY KEY );
CREATE TABLE IF NOT EXISTS project_path (
  project_id TEXT NOT NULL, cwd TEXT NOT NULL, is_home INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, cwd)
);
-- Directories explicitly imported into the 无归属 (unattached) session bucket (the OLD vanilla app's
-- 导入目录, still supported). KEPT as a surfacing root; project_path / launch_intent cwds are NOT.
CREATE TABLE IF NOT EXISTS session_import_dir ( cwd TEXT PRIMARY KEY );
-- Session-grained import: a session is explicitly in Berth's visible set. The new canonical way to
-- surface a session — registering a 货舱 cwd (project_path) no longer surfaces all its sessions.
CREATE TABLE IF NOT EXISTS session_import ( session_id TEXT PRIMARY KEY );
`

function cols(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => r.name))
}

function migrateProjectRefs(db: Database.Database) {
  const projectIdFor = (value: string | null | undefined): string | null => {
    if (!value) return null
    const byId = db.prepare('SELECT id FROM project WHERE id=?').get(value) as any
    if (byId) return byId.id
    const byName = db.prepare('SELECT id FROM project WHERE name=?').get(value) as any
    return byName?.id ?? null
  }

  if (cols(db, 'archived_project').has('name')) {
    db.prepare('CREATE TABLE archived_project_new (project_id TEXT PRIMARY KEY)').run()
    for (const r of db.prepare('SELECT name FROM archived_project').all() as any[]) {
      const id = projectIdFor(r.name)
      if (id) db.prepare('INSERT OR IGNORE INTO archived_project_new (project_id) VALUES (?)').run(id)
    }
    db.prepare('DROP TABLE archived_project').run()
    db.prepare('ALTER TABLE archived_project_new RENAME TO archived_project').run()
  }

  if (cols(db, 'project_path').has('name')) {
    db.prepare(`CREATE TABLE project_path_new (
      project_id TEXT NOT NULL, cwd TEXT NOT NULL, is_home INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, cwd)
    )`).run()
    for (const r of db.prepare('SELECT name, cwd, is_home FROM project_path').all() as any[]) {
      const id = projectIdFor(r.name)
      if (id) db.prepare(`INSERT INTO project_path_new (project_id,cwd,is_home) VALUES (?,?,?)
        ON CONFLICT(project_id,cwd) DO UPDATE SET is_home=MAX(is_home, excluded.is_home)`).run(id, r.cwd, r.is_home)
    }
    db.prepare('DROP TABLE project_path').run()
    db.prepare('ALTER TABLE project_path_new RENAME TO project_path').run()
  }

  for (const table of ['attach', 'launch_intent']) {
    for (const r of db.prepare(`SELECT rowid, project_id FROM ${table} WHERE project_id IS NOT NULL AND project_id<>''`).all() as any[]) {
      const id = projectIdFor(r.project_id)
      if (id && id !== r.project_id) db.prepare(`UPDATE ${table} SET project_id=? WHERE rowid=?`).run(id, r.rowid)
    }
  }
}

export function openStore(path: string) {
  const db = new Database(path)
  // Soft foreign keys (design §2.2): attach/edge reference external session ids that may not be
  // indexed yet — a freshly-launched session is attributed before the next store refresh ingests it.
  // better-sqlite3 enables FK enforcement by default; turn it OFF so those forward references are allowed.
  db.pragma('foreign_keys = OFF')
  db.exec(SCHEMA)
  db.exec(DATA_SCHEMA)
  migrateDataSchema(db)
  migrateProjectRefs(db)
  // M1: per-path 「默认装载」 toggle. The project_path rebuild in migrateProjectRefs is self-terminating
  // (it drops the legacy `name` col), so it can never re-drop this column on a later boot.
  if (!cols(db, 'project_path').has('enabled'))
    db.exec('ALTER TABLE project_path ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
  const upsert = db.prepare(`INSERT INTO logical_session
    (session_id,cli,cwd,title,updated_at,content_source_path,resume_cli,resume_id,deleted)
    VALUES (@session_id,@cli,@cwd,@title,@updated_at,@content_source_path,@resume_cli,@resume_id,@deleted)
    ON CONFLICT(session_id) DO UPDATE SET cli=excluded.cli, cwd=excluded.cwd, title=excluded.title,
      updated_at=excluded.updated_at, content_source_path=excluded.content_source_path,
      resume_cli=excluded.resume_cli, resume_id=excluded.resume_id, deleted=excluded.deleted`)
  return {
    upsertSessions(ss: LogicalSession[]) {
      const tx = db.transaction((rows: LogicalSession[]) => { for (const s of rows) upsert.run({
        session_id:s.sessionId, cli:s.cli, cwd:s.cwd, title:s.title, updated_at:s.updatedAt,
        content_source_path:s.contentSourcePath, resume_cli:s.resume?.cli ?? null,
        resume_id:s.resume?.id ?? null, deleted: s.deleted ? 1 : 0 }) })
      tx(ss)
    },
    allSessions() { return db.prepare('SELECT * FROM logical_session').all() },
    setAttach(id: string, projectId: string | null, state: string) {
      db.prepare(`INSERT INTO attach (session_id,project_id,state) VALUES (?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id, state=excluded.state`)
        .run(id, projectId, state)
    },
    getAttach(id: string) {
      const r = db.prepare('SELECT project_id as projectId, state FROM attach WHERE session_id=?').get(id) as any
      return r ?? null
    },
    setPin(id: string, on: boolean) {
      if (on) db.prepare('INSERT OR IGNORE INTO pin (session_id) VALUES (?)').run(id)
      else db.prepare('DELETE FROM pin WHERE session_id=?').run(id)
    },
    isPinned(id: string) { return !!db.prepare('SELECT 1 FROM pin WHERE session_id=?').get(id) },
    allPinnedSet(): Set<string> {
      return new Set((db.prepare('SELECT session_id FROM pin').all() as any[]).map(r => r.session_id))
    },
    allAttachMap(): Map<string, { projectId: string | null; state: string }> {
      const m = new Map<string, { projectId: string | null; state: string }>()
      for (const r of db.prepare('SELECT session_id, project_id, state FROM attach').all() as any[])
        m.set(r.session_id, { projectId: r.project_id, state: r.state })
      return m
    },
    setTitleOverride(id: string, title: string) {
      db.prepare(`INSERT INTO title_override (session_id,title) VALUES (?,?)
        ON CONFLICT(session_id) DO UPDATE SET title=excluded.title`).run(id, title)
    },
    allTitleOverrides(): Map<string, string> {
      const m = new Map<string, string>()
      for (const r of db.prepare('SELECT session_id, title FROM title_override').all() as any[]) m.set(r.session_id, r.title)
      return m
    },
    setArchived(projectId: string, on: boolean) {
      if (on) db.prepare('INSERT OR IGNORE INTO archived_project (project_id) VALUES (?)').run(projectId)
      else db.prepare('DELETE FROM archived_project WHERE project_id=?').run(projectId)
    },
    allArchivedSet(): Set<string> {
      return new Set((db.prepare('SELECT project_id FROM archived_project').all() as any[]).map(r => r.project_id))
    },
    addProjectPath(projectId: string, cwd: string, isHome = false, enabled = true) {
      // A new home demotes any prior home for this project.
      if (isHome) db.prepare('UPDATE project_path SET is_home=0 WHERE project_id=?').run(projectId)
      db.prepare(`INSERT INTO project_path (project_id,cwd,is_home,enabled) VALUES (?,?,?,?)
        ON CONFLICT(project_id,cwd) DO UPDATE SET is_home=MAX(is_home, excluded.is_home), enabled=excluded.enabled`)
        .run(projectId, cwd, isHome ? 1 : 0, enabled ? 1 : 0)
    },
    setPathEnabled(projectId: string, cwd: string, enabled: boolean) {
      db.prepare('UPDATE project_path SET enabled=? WHERE project_id=? AND cwd=?').run(enabled ? 1 : 0, projectId, cwd)
    },
    removeProjectPath(projectId: string, cwd: string) {
      db.prepare('DELETE FROM project_path WHERE project_id=? AND cwd=?').run(projectId, cwd)
    },
    /** projectId → { home: cwd|null, paths: cwd[], meta: {cwd,enabled}[] }. `paths` stays a bare
     *  string[] for back-compat (old public/app.js + the React ApiProject); `meta` carries the toggle. */
    allProjectPaths(): Map<string, { home: string | null; paths: string[]; meta: { cwd: string; enabled: boolean }[] }> {
      const m = new Map<string, { home: string | null; paths: string[]; meta: { cwd: string; enabled: boolean }[] }>()
      for (const r of db.prepare('SELECT project_id, cwd, is_home, enabled FROM project_path').all() as any[]) {
        if (!m.has(r.project_id)) m.set(r.project_id, { home: null, paths: [], meta: [] })
        const e = m.get(r.project_id)!
        e.paths.push(r.cwd)
        e.meta.push({ cwd: r.cwd, enabled: !!r.enabled })
        if (r.is_home) e.home = r.cwd
      }
      return m
    },
    addEdge(todoKey: string, sessionId: string) {
      db.prepare('INSERT OR IGNORE INTO edge (todo_key, session_id) VALUES (?,?)').run(todoKey, sessionId)
    },
    removeEdgesForSession(sessionId: string) {
      db.prepare('DELETE FROM edge WHERE session_id=?').run(sessionId)
    },
    edgesByTodo(): Map<string, string[]> {
      const m = new Map<string, string[]>()
      for (const r of db.prepare('SELECT todo_key, session_id FROM edge').all() as any[]) {
        if (!m.has(r.todo_key)) m.set(r.todo_key, [])
        m.get(r.todo_key)!.push(r.session_id)
      }
      return m
    },
    todoKeyForSession(sessionId: string): string | null {
      const r = db.prepare('SELECT todo_key FROM edge WHERE session_id=? LIMIT 1').get(sessionId) as any
      return r?.todo_key ?? null
    },
    addLaunchIntent(i: LaunchIntent) {
      db.prepare(`INSERT OR REPLACE INTO launch_intent
        (id,cli,cwd,project_id,todo_key,session_id,created_at,bound)
        VALUES (@id,@cli,@cwd,@projectId,@todoKey,@sessionId,@createdAt,@bound)`)
        .run({ ...i, bound: i.bound ? 1 : 0 })
    },
    pendingIntents(): LaunchIntent[] {
      return (db.prepare('SELECT * FROM launch_intent WHERE bound=0').all() as any[]).map(r => ({
        id: r.id, cli: r.cli, cwd: r.cwd, projectId: r.project_id, todoKey: r.todo_key,
        sessionId: r.session_id, createdAt: r.created_at, bound: !!r.bound,
      }))
    },
    bindIntent(id: string, sessionId: string) {
      db.prepare('UPDATE launch_intent SET session_id=?, bound=1 WHERE id=?').run(sessionId, id)
    },
    /** Distinct cwds of every launch intent (bound or not) — implicit session-import roots so any
     *  Berth-launched session surfaces even if its cwd was never explicitly imported. */
    allLaunchIntentCwds(): string[] {
      return (db.prepare('SELECT DISTINCT cwd FROM launch_intent WHERE cwd IS NOT NULL').all() as any[]).map(r => r.cwd)
    },
    // ── Session import directories (the 无归属 import roots) ──
    addSessionImportDir(cwd: string) {
      db.prepare('INSERT OR IGNORE INTO session_import_dir (cwd) VALUES (?)').run(canonicalPathKey(cwd))
    },
    removeSessionImportDir(cwd: string) {
      db.prepare('DELETE FROM session_import_dir WHERE cwd=? OR cwd=?').run(cwd, canonicalPathKey(cwd))
    },
    allSessionImportDirs(): string[] {
      return (db.prepare('SELECT cwd FROM session_import_dir ORDER BY cwd').all() as any[]).map(r => r.cwd)
    },
    // ── Session-grained import (the new canonical surfacing signal) ──
    addSessionImport(sessionId: string) {
      db.prepare('INSERT OR IGNORE INTO session_import (session_id) VALUES (?)').run(sessionId)
    },
    removeSessionImport(sessionId: string) {
      db.prepare('DELETE FROM session_import WHERE session_id=?').run(sessionId)
    },
    allSessionImportSet(): Set<string> {
      return new Set((db.prepare('SELECT session_id FROM session_import').all() as any[]).map(r => r.session_id))
    },
    /** Session ids of bound launch intents — Berth-launched sessions surface per-session via this
     *  (replacing launch_intent.cwd as a directory-wide import root). */
    allBoundLaunchSessionIds(): Set<string> {
      return new Set((db.prepare('SELECT session_id FROM launch_intent WHERE bound=1 AND session_id IS NOT NULL').all() as any[]).map(r => r.session_id))
    },
    ...dataMethods(db),
  }
}
