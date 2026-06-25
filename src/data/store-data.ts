import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Task, TaskFields, Project, ExternalRef, Conflict, DataSourceRow, SyncMode } from './types'

// Canonical data-layer tables (tasks/projects/refs/sources/conflicts/settings). Kept here to keep
// db/store.ts focused; `openStore` spreads `dataMethods(db)` into its returned object.
export const DATA_SCHEMA = `
CREATE TABLE IF NOT EXISTS task (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  status       TEXT,
  priority     TEXT,
  project_id   TEXT,
  detail_doc   TEXT,
  progress     TEXT,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  synced_at    INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hue  TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS external_ref (
  entity_kind         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  source_id           TEXT NOT NULL,
  external_id         TEXT NOT NULL,
  external_hash       TEXT,
  external_updated_at INTEGER,
  PRIMARY KEY (entity_kind, entity_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_external_ref_lookup ON external_ref (source_id, entity_kind, external_id);
CREATE TABLE IF NOT EXISTS data_source (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  label       TEXT,
  config_json TEXT NOT NULL,
  pull_mode   TEXT NOT NULL DEFAULT 'manual',
  push_mode   TEXT NOT NULL DEFAULT 'manual',
  enabled     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sync_conflict (
  id                     TEXT PRIMARY KEY,
  entity_kind            TEXT NOT NULL,
  entity_id              TEXT NOT NULL,
  source_id              TEXT NOT NULL,
  berth_snapshot_json    TEXT NOT NULL,
  external_snapshot_json TEXT NOT NULL,
  detected_at            INTEGER NOT NULL,
  resolved               INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Local-only (NOT synced) per-task deadline overlay, keyed by task.id. ddl is a bare local date
-- string 'YYYY-MM-DD'. Soft FK (foreign_keys is OFF repo-wide); orphan rows are harmless.
CREATE TABLE IF NOT EXISTS task_ddl ( task_id TEXT PRIMARY KEY, ddl TEXT NOT NULL );
`

function cols(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => r.name))
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table)
}

function ensureProjectIds(db: Database.Database) {
  if (!tableExists(db, 'project')) return
  const c = cols(db, 'project')
  if (!c.has('id')) {
    db.prepare('ALTER TABLE project ADD COLUMN id TEXT').run()
    for (const r of db.prepare("SELECT rowid FROM project WHERE id IS NULL OR id=''").all() as any[]) {
      db.prepare('UPDATE project SET id=? WHERE rowid=?').run(randomUUID(), r.rowid)
    }
  }
  const rows = db.prepare("SELECT rowid, id FROM project WHERE id IS NULL OR id=''").all() as any[]
  for (const r of rows) db.prepare('UPDATE project SET id=? WHERE rowid=?').run(randomUUID(), r.rowid)

  // Rebuild once so fresh and migrated stores agree: project identity is `id`, name is mutable.
  const pk = (db.prepare('PRAGMA table_info(project)').all() as any[]).find(r => r.pk)
  if (pk?.name !== 'id') {
    db.prepare(`CREATE TABLE project_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      hue TEXT,
      sort INTEGER NOT NULL DEFAULT 0
    )`).run()
    db.prepare(`INSERT OR IGNORE INTO project_new (id,name,hue,sort)
      SELECT COALESCE(NULLIF(id,''), lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
             name, hue, COALESCE(sort,0)
      FROM project`).run()
    db.prepare('DROP TABLE project').run()
    db.prepare('ALTER TABLE project_new RENAME TO project').run()
  }
}

function ensureTaskProjectIds(db: Database.Database) {
  if (!tableExists(db, 'task')) return
  const c = cols(db, 'task')
  if (!c.has('project_id')) db.prepare('ALTER TABLE task ADD COLUMN project_id TEXT').run()
  if (c.has('project')) {
    db.prepare(`UPDATE task
      SET project_id = (SELECT id FROM project WHERE project.name = task.project)
      WHERE (project_id IS NULL OR project_id='') AND project IS NOT NULL AND project<>''`).run()

    db.prepare(`CREATE TABLE task_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT,
      priority TEXT,
      project_id TEXT,
      detail_doc TEXT,
      progress TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    )`).run()
    db.prepare(`INSERT OR REPLACE INTO task_new
      (id,title,status,priority,project_id,detail_doc,progress,updated_at,synced_at,deleted)
      SELECT id,title,status,priority,project_id,detail_doc,progress,updated_at,synced_at,deleted FROM task`).run()
    db.prepare('DROP TABLE task').run()
    db.prepare('ALTER TABLE task_new RENAME TO task').run()
  }
}

export function migrateDataSchema(db: Database.Database) {
  ensureProjectIds(db)
  ensureTaskProjectIds(db)
}

function rowToTask(r: any): Task {
  return {
    id: r.id, title: r.title, status: r.status, priority: r.priority,
    projectId: r.project_id ?? null, project: r.project_name ?? null,
    detailDoc: r.detail_doc, progress: r.progress,
    updatedAt: r.updated_at, syncedAt: r.synced_at, deleted: !!r.deleted,
  }
}
function rowToRef(r: any): ExternalRef {
  return {
    entityKind: r.entity_kind, entityId: r.entity_id, sourceId: r.source_id,
    externalId: r.external_id, externalHash: r.external_hash, externalUpdatedAt: r.external_updated_at,
  }
}
function rowToSource(r: any): DataSourceRow {
  return {
    id: r.id, kind: r.kind, label: r.label, config: JSON.parse(r.config_json),
    pullMode: r.pull_mode as SyncMode, pushMode: r.push_mode as SyncMode, enabled: !!r.enabled,
  }
}
function rowToConflict(r: any): Conflict {
  return {
    id: r.id, entityKind: r.entity_kind, entityId: r.entity_id, sourceId: r.source_id,
    berth: JSON.parse(r.berth_snapshot_json), external: JSON.parse(r.external_snapshot_json),
    detectedAt: r.detected_at, resolved: !!r.resolved,
  }
}

const TASK_FIELD_COL: Record<keyof TaskFields, string> = {
  title: 'title', status: 'status', priority: 'priority', project: 'project_id',
  detailDoc: 'detail_doc', progress: 'progress',
}

export function dataMethods(db: Database.Database) {
  function upsertProjectByName(name: string, hue?: string | null): Project {
    const n = name.trim()
    const existing = db.prepare('SELECT id, name, hue FROM project WHERE name=?').get(n) as any
    if (existing) {
      if (hue !== undefined) db.prepare('UPDATE project SET hue=? WHERE id=?').run(hue, existing.id)
      return { id: existing.id, name: existing.name, hue: (hue ?? existing.hue) ?? undefined }
    }
    const id = randomUUID()
    db.prepare('INSERT INTO project (id,name,hue) VALUES (?,?,?)').run(id, n, hue ?? null)
    return { id, name: n, hue: hue ?? undefined }
  }
  function resolveProjectId(input: string | null | undefined, createByName = true): string | null {
    const v = typeof input === 'string' ? input.trim() : ''
    if (!v) return null
    const byId = db.prepare('SELECT id FROM project WHERE id=?').get(v) as any
    if (byId) return byId.id
    const byName = db.prepare('SELECT id FROM project WHERE name=?').get(v) as any
    if (byName) return byName.id
    return createByName ? upsertProjectByName(v).id : null
  }
  return {
    // ── tasks ──────────────────────────────────────────────────────────────
    insertTask(t: Task) {
      const projectId = t.projectId ?? resolveProjectId(t.project, true)
      db.prepare(`INSERT INTO task (id,title,status,priority,project_id,detail_doc,progress,updated_at,synced_at,deleted)
        VALUES (@id,@title,@status,@priority,@project_id,@detail_doc,@progress,@updated_at,@synced_at,@deleted)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, priority=excluded.priority,
          project_id=excluded.project_id, detail_doc=excluded.detail_doc, progress=excluded.progress,
          updated_at=excluded.updated_at, synced_at=excluded.synced_at, deleted=excluded.deleted`)
        .run({
          id: t.id, title: t.title, status: t.status, priority: t.priority, project_id: projectId,
          detail_doc: t.detailDoc, progress: t.progress,
          updated_at: t.updatedAt, synced_at: t.syncedAt, deleted: t.deleted ? 1 : 0,
        })
    },
    getTask(id: string): Task | null {
      const r = db.prepare('SELECT task.*, project.name AS project_name FROM task LEFT JOIN project ON project.id=task.project_id WHERE task.id=?').get(id)
      return r ? rowToTask(r) : null
    },
    allTasks(includeDeleted = false): Task[] {
      const rows = includeDeleted
        ? db.prepare('SELECT task.*, project.name AS project_name FROM task LEFT JOIN project ON project.id=task.project_id').all()
        : db.prepare('SELECT task.*, project.name AS project_name FROM task LEFT JOIN project ON project.id=task.project_id WHERE deleted=0').all()
      return (rows as any[]).map(rowToTask)
    },
    updateTaskFields(id: string, patch: Partial<TaskFields> & { projectId?: string | null }, updatedAt: number) {
      const sets: string[] = []
      const params: any = { id, updated_at: updatedAt }
      for (const k of Object.keys(patch) as (keyof TaskFields | 'projectId')[]) {
        if (k === 'projectId') {
          sets.push('project_id=@project_id')
          params.project_id = resolveProjectId((patch as any).projectId, false)
          continue
        }
        if (k === 'project') {
          sets.push('project_id=@project_id')
          params.project_id = resolveProjectId((patch as any).project, true)
          continue
        }
        const col = TASK_FIELD_COL[k]
        if (!col) continue
        sets.push(`${col}=@${col}`)
        params[col] = (patch as any)[k]
      }
      sets.push('updated_at=@updated_at')
      db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id=@id`).run(params)
    },
    softDeleteTask(id: string, updatedAt: number) {
      db.prepare('UPDATE task SET deleted=1, updated_at=? WHERE id=?').run(updatedAt, id)
    },
    setTaskSynced(id: string, syncedAt: number) {
      db.prepare('UPDATE task SET synced_at=? WHERE id=?').run(syncedAt, id)
    },

    // ── projects ───────────────────────────────────────────────────────────
    upsertProject(p: Project | { id?: string; name: string; hue?: string }) {
      if (!p.id) return upsertProjectByName(p.name, p.hue)
      db.prepare(`INSERT INTO project (id,name,hue) VALUES (?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, hue=excluded.hue`).run(p.id, p.name, p.hue ?? null)
      return p
    },
    allProjects(): Project[] {
      return (db.prepare('SELECT id, name, hue FROM project ORDER BY sort, name').all() as any[])
        .map(r => ({ id: r.id, name: r.name, hue: r.hue ?? undefined }))
    },
    getProject(id: string): Project | null {
      const r = db.prepare('SELECT id, name, hue FROM project WHERE id=?').get(id) as any
      return r ? { id: r.id, name: r.name, hue: r.hue ?? undefined } : null
    },
    getProjectByName(name: string): Project | null {
      const r = db.prepare('SELECT id, name, hue FROM project WHERE name=?').get(name) as any
      return r ? { id: r.id, name: r.name, hue: r.hue ?? undefined } : null
    },
    resolveProjectId(input: string): string | null {
      return resolveProjectId(input, false)
    },
    updateProject(id: string, patch: { name?: string; hue?: string | null }, updatedAt: number) {
      const existing = db.prepare('SELECT id, name, hue FROM project WHERE id=?').get(id) as any
      if (!existing) throw new Error('unknown project')
      const sets: string[] = []
      const params: any = { id }
      if (patch.name !== undefined) {
        const n = patch.name.trim()
        if (!n) throw new Error('empty project name')
        const dup = db.prepare('SELECT id FROM project WHERE name=? AND id<>?').get(n, id) as any
        if (dup) throw new Error('project name already exists')
        sets.push('name=@name')
        params.name = n
      }
      if (patch.hue !== undefined) {
        sets.push('hue=@hue')
        params.hue = patch.hue
      }
      if (!sets.length) throw new Error('no editable fields in patch')
      db.prepare(`UPDATE project SET ${sets.join(', ')} WHERE id=@id`).run(params)
      // Project name is part of a task's synced field projection, so mark member tasks dirty.
      db.prepare('UPDATE task SET updated_at=? WHERE project_id=?').run(updatedAt, id)
      const r = db.prepare('SELECT id, name, hue FROM project WHERE id=?').get(id) as any
      return { id: r.id, name: r.name, hue: r.hue ?? undefined }
    },
    setProjectSort(id: string, sort: number) {
      db.prepare('UPDATE project SET sort=? WHERE id=?').run(sort, id)
    },
    deleteProject(id: string, updatedAt: number) {
      const existing = db.prepare('SELECT id FROM project WHERE id=?').get(id) as any
      if (!existing) throw new Error('unknown project')
      const tx = db.transaction(() => {
        db.prepare('UPDATE task SET project_id=NULL, updated_at=? WHERE project_id=?').run(updatedAt, id)
        db.prepare('UPDATE attach SET project_id=NULL WHERE project_id=?').run(id)
        db.prepare('UPDATE launch_intent SET project_id=NULL WHERE project_id=?').run(id)
        db.prepare('DELETE FROM archived_project WHERE project_id=?').run(id)
        db.prepare('DELETE FROM project_path WHERE project_id=?').run(id)
        db.prepare('DELETE FROM app_setting WHERE key=?').run(`project_last_cwd:${id}`)
        db.prepare("DELETE FROM external_ref WHERE entity_kind='project' AND entity_id=?").run(id)
        db.prepare("DELETE FROM sync_conflict WHERE entity_kind='project' AND entity_id=?").run(id)
        db.prepare('DELETE FROM project WHERE id=?').run(id)
      })
      tx()
    },

    // ── external refs ────────────────────────────────────────────────────────
    putRef(ref: ExternalRef) {
      db.prepare(`INSERT INTO external_ref (entity_kind,entity_id,source_id,external_id,external_hash,external_updated_at)
        VALUES (@entity_kind,@entity_id,@source_id,@external_id,@external_hash,@external_updated_at)
        ON CONFLICT(entity_kind,entity_id,source_id) DO UPDATE SET
          external_id=excluded.external_id, external_hash=excluded.external_hash, external_updated_at=excluded.external_updated_at`)
        .run({
          entity_kind: ref.entityKind, entity_id: ref.entityId, source_id: ref.sourceId,
          external_id: ref.externalId, external_hash: ref.externalHash, external_updated_at: ref.externalUpdatedAt,
        })
    },
    getRef(kind: 'task' | 'project', entityId: string, sourceId: string): ExternalRef | null {
      const r = db.prepare('SELECT * FROM external_ref WHERE entity_kind=? AND entity_id=? AND source_id=?').get(kind, entityId, sourceId)
      return r ? rowToRef(r) : null
    },
    getRefByExternal(sourceId: string, kind: 'task' | 'project', externalId: string): ExternalRef | null {
      const r = db.prepare('SELECT * FROM external_ref WHERE source_id=? AND entity_kind=? AND external_id=?').get(sourceId, kind, externalId)
      return r ? rowToRef(r) : null
    },
    deleteRef(kind: 'task' | 'project', entityId: string, sourceId: string) {
      db.prepare('DELETE FROM external_ref WHERE entity_kind=? AND entity_id=? AND source_id=?').run(kind, entityId, sourceId)
    },
    refsForSource(sourceId: string, kind: 'task' | 'project'): ExternalRef[] {
      return (db.prepare('SELECT * FROM external_ref WHERE source_id=? AND entity_kind=?').all(sourceId, kind) as any[]).map(rowToRef)
    },

    // ── data sources ─────────────────────────────────────────────────────────
    allDataSources(): DataSourceRow[] {
      return (db.prepare('SELECT * FROM data_source').all() as any[]).map(rowToSource)
    },
    getDataSource(id: string): DataSourceRow | null {
      const r = db.prepare('SELECT * FROM data_source WHERE id=?').get(id)
      return r ? rowToSource(r) : null
    },
    upsertDataSource(row: DataSourceRow) {
      db.prepare(`INSERT INTO data_source (id,kind,label,config_json,pull_mode,push_mode,enabled)
        VALUES (@id,@kind,@label,@config_json,@pull_mode,@push_mode,@enabled)
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, label=excluded.label, config_json=excluded.config_json,
          pull_mode=excluded.pull_mode, push_mode=excluded.push_mode, enabled=excluded.enabled`)
        .run({
          id: row.id, kind: row.kind, label: row.label ?? null, config_json: JSON.stringify(row.config ?? {}),
          pull_mode: row.pullMode, push_mode: row.pushMode, enabled: row.enabled ? 1 : 0,
        })
    },
    deleteDataSource(id: string) {
      db.prepare('DELETE FROM data_source WHERE id=?').run(id)
    },

    // ── conflicts ──────────────────────────────────────────────────────────
    addConflict(c: Conflict) {
      db.prepare(`INSERT INTO sync_conflict (id,entity_kind,entity_id,source_id,berth_snapshot_json,external_snapshot_json,detected_at,resolved)
        VALUES (@id,@entity_kind,@entity_id,@source_id,@berth,@external,@detected_at,@resolved)
        ON CONFLICT(id) DO UPDATE SET berth_snapshot_json=excluded.berth_snapshot_json,
          external_snapshot_json=excluded.external_snapshot_json, detected_at=excluded.detected_at, resolved=excluded.resolved`)
        .run({
          id: c.id, entity_kind: c.entityKind, entity_id: c.entityId, source_id: c.sourceId,
          berth: JSON.stringify(c.berth), external: JSON.stringify(c.external),
          detected_at: c.detectedAt, resolved: c.resolved ? 1 : 0,
        })
    },
    openConflicts(): Conflict[] {
      return (db.prepare('SELECT * FROM sync_conflict WHERE resolved=0 ORDER BY detected_at').all() as any[]).map(rowToConflict)
    },
    getConflict(id: string): Conflict | null {
      const r = db.prepare('SELECT * FROM sync_conflict WHERE id=?').get(id)
      return r ? rowToConflict(r) : null
    },
    resolveConflict(id: string) {
      db.prepare('UPDATE sync_conflict SET resolved=1 WHERE id=?').run(id)
    },

    // ── app settings ─────────────────────────────────────────────────────────
    getSetting(key: string): string | null {
      const r = db.prepare('SELECT value FROM app_setting WHERE key=?').get(key) as any
      return r?.value ?? null
    },
    setSetting(key: string, value: string) {
      db.prepare(`INSERT INTO app_setting (key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value)
    },

    // ── task ddl (local-only deadline overlay, NOT synced) ────────────────────
    setTaskDdl(id: string, date: string | null) {
      const d = (date ?? '').trim()
      if (!d) { db.prepare('DELETE FROM task_ddl WHERE task_id=?').run(id); return }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid ddl date: ${date}`)
      db.prepare(`INSERT INTO task_ddl (task_id,ddl) VALUES (?,?)
        ON CONFLICT(task_id) DO UPDATE SET ddl=excluded.ddl`).run(id, d)
    },
    allTaskDdls(): Map<string, string> {
      const m = new Map<string, string>()
      for (const r of db.prepare('SELECT task_id, ddl FROM task_ddl').all() as any[]) m.set(r.task_id, r.ddl)
      return m
    },

    // ── identity-migration helpers (used once by migrate.ts) ──────────────────
    allEdges(): { todoKey: string; sessionId: string }[] {
      return (db.prepare('SELECT todo_key, session_id FROM edge').all() as any[])
        .map(r => ({ todoKey: r.todo_key, sessionId: r.session_id }))
    },
    rewriteEdgeKey(oldKey: string, newKey: string) {
      db.prepare('UPDATE OR IGNORE edge SET todo_key=? WHERE todo_key=?').run(newKey, oldKey)
      db.prepare('DELETE FROM edge WHERE todo_key=?').run(oldKey)  // clear any rows the IGNORE skipped (dup PK)
    },
    rewriteIntentKey(oldKey: string, newKey: string) {
      db.prepare('UPDATE launch_intent SET todo_key=? WHERE todo_key=?').run(newKey, oldKey)
    },
  }
}
