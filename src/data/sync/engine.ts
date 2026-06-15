import { randomUUID } from 'node:crypto'
import type { DataSourceRow, Conflict, Task } from '../types'
import type { DataSourceAdapter, AdapterContext } from './adapter'
import { getAdapter } from './registry'
import { hashFields, fieldsOf } from './hash'

type Store = ReturnType<typeof import('../../db/store').openStore>
type Now = () => number

export interface SyncResult { conflicts: Conflict[]; pulled: number; pushed: number }
export interface SyncOpts { pull?: boolean; push?: boolean; now?: Now }

/**
 * Sync one source against the internal store. Pull applies external changes / mints new tasks; push
 * sends Berth changes / creates / deletes externally. When BOTH sides changed since the last sync a
 * conflict is recorded and NOTHING is applied for that row — the user resolves it (resolveConflict).
 *
 * The adapter is injectable (last arg) for tests; production resolves it from the registry by kind.
 */
export async function syncSource(
  store: Store,
  src: DataSourceRow,
  ctx: AdapterContext,
  opts: SyncOpts = {},
  adapter: DataSourceAdapter = getAdapter(src.kind),
): Promise<SyncResult> {
  const now = opts.now ?? Date.now
  const doPull = opts.pull !== false
  const doPush = opts.push !== false
  let pulled = 0, pushed = 0

  // entities (by id) that currently have an OPEN conflict for this source — never auto-apply/push them.
  const conflicted = new Set(store.openConflicts().filter(c => c.sourceId === src.id).map(c => c.entityId))

  if (doPull) {
    const records = await adapter.pullTasks(src, ctx)
    for (const rec of records) {
      const ref = store.getRefByExternal(src.id, 'task', rec.externalId)
      if (!ref) {
        // brand-new external task → mint a Berth task
        const id = randomUUID()
        const t = now()
        const task: Task = { id, ...rec.fields, projectId: null, updatedAt: t, syncedAt: t, deleted: false }
        store.insertTask(task)
        store.putRef({ entityKind: 'task', entityId: id, sourceId: src.id, externalId: rec.externalId, externalHash: rec.hash, externalUpdatedAt: rec.externalUpdatedAt ?? null })
        pulled++
        continue
      }
      const task = store.getTask(ref.entityId)
      if (!task) continue   // orphan ref (task hard-deleted) — skip
      if (conflicted.has(task.id)) continue
      const berthChanged = task.updatedAt > task.syncedAt
      const externalChanged = rec.hash !== ref.externalHash
      if (berthChanged && externalChanged) {
        store.addConflict({ id: randomUUID(), entityKind: 'task', entityId: task.id, sourceId: src.id, berth: fieldsOf(task), external: rec.fields, detectedAt: now(), resolved: false })
        conflicted.add(task.id)
      } else if (externalChanged) {
        const t = now()
        store.updateTaskFields(task.id, rec.fields, t)
        store.setTaskSynced(task.id, t)
        store.putRef({ entityKind: 'task', entityId: task.id, sourceId: src.id, externalId: rec.externalId, externalHash: rec.hash, externalUpdatedAt: rec.externalUpdatedAt ?? null })
        pulled++
      }
      // berth-only or unchanged → left for push
    }

    // projects: additive pull only (name-keyed; no conflicts)
    if (adapter.pullProjects) {
      const existing = new Set(store.allProjects().map(p => p.name))
      for (const p of await adapter.pullProjects(src, ctx)) {
        if (!existing.has(p.name)) store.upsertProject(p)
      }
    }
  }

  if (doPush) {
    // Ensure external project options exist for every project a dirty task references (deduped, once)
    // so createTask/updateTask never writes a select value the source doesn't know.
    if (adapter.ensureProjectOption) {
      const dirtyProjects = new Set<string>()
      for (const t of store.allTasks(true)) {
        if (!t.deleted && t.project && t.updatedAt > t.syncedAt && !conflicted.has(t.id)) dirtyProjects.add(t.project)
      }
      for (const name of dirtyProjects) {
        const hue = store.allProjects().find(p => p.name === name)?.hue
        try { await adapter.ensureProjectOption(src, name, hue, ctx) } catch { /* best-effort */ }
      }
    }
    for (const task of store.allTasks(true)) {
      const ref = store.getRef('task', task.id, src.id)
      if (task.deleted) {
        if (ref) { await adapter.deleteTask(src, ref.externalId, ctx); store.deleteRef('task', task.id, src.id); pushed++ }
        continue
      }
      if (conflicted.has(task.id)) continue
      const dirty = task.updatedAt > task.syncedAt
      if (!dirty) continue
      const t = now()
      if (ref) {
        await adapter.updateTask(src, ref.externalId, fieldsOf(task), ctx)
        store.putRef({ entityKind: 'task', entityId: task.id, sourceId: src.id, externalId: ref.externalId, externalHash: hashFields(fieldsOf(task)), externalUpdatedAt: t })
      } else {
        const externalId = await adapter.createTask(src, task, ctx)
        store.putRef({ entityKind: 'task', entityId: task.id, sourceId: src.id, externalId, externalHash: hashFields(fieldsOf(task)), externalUpdatedAt: t })
      }
      store.setTaskSynced(task.id, t)
      pushed++
    }
  }

  return { conflicts: store.openConflicts(), pulled, pushed }
}

/** Resolve one conflict by choosing a side; applies that side and clears the conflict. */
export async function resolveConflict(
  store: Store,
  conflictId: string,
  side: 'berth' | 'external',
  ctx: AdapterContext,
  adapterFor: (kind: string) => DataSourceAdapter = getAdapter,
  now: Now = Date.now,
): Promise<void> {
  const c = store.getConflict(conflictId)
  if (!c || c.resolved) return
  const src = store.getDataSource(c.sourceId)
  if (!src) { store.resolveConflict(conflictId); return }
  const adapter = adapterFor(src.kind)
  const t = now()

  if (side === 'external') {
    store.updateTaskFields(c.entityId, c.external, t)
    store.setTaskSynced(c.entityId, t)
    store.putRef({ entityKind: 'task', entityId: c.entityId, sourceId: src.id, externalId: refExternalId(store, c.entityId, src.id), externalHash: hashFields(c.external), externalUpdatedAt: t })
  } else {
    const task = store.getTask(c.entityId)
    if (task) {
      const ref = store.getRef('task', c.entityId, src.id)
      if (ref) {
        await adapter.updateTask(src, ref.externalId, fieldsOf(task), ctx)
        store.putRef({ entityKind: 'task', entityId: c.entityId, sourceId: src.id, externalId: ref.externalId, externalHash: hashFields(fieldsOf(task)), externalUpdatedAt: t })
      } else {
        const externalId = await adapter.createTask(src, task, ctx)
        store.putRef({ entityKind: 'task', entityId: c.entityId, sourceId: src.id, externalId, externalHash: hashFields(fieldsOf(task)), externalUpdatedAt: t })
      }
      store.setTaskSynced(c.entityId, t)
    }
  }
  store.resolveConflict(conflictId)
}

function refExternalId(store: Store, entityId: string, sourceId: string): string {
  return store.getRef('task', entityId, sourceId)?.externalId ?? ''
}
