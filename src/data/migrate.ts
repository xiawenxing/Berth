import { randomUUID } from 'node:crypto'
import { getAdapter } from './sync/registry'
import type { AdapterContext, DataSourceAdapter } from './sync/adapter'

type Store = ReturnType<typeof import('../db/store').openStore>
type Now = () => number

/**
 * One-time identity migration: the old world keyed everything on the Feishu `recordId`; the new world
 * uses Berth uuids with an external_ref map. This pulls the primary Feishu source's rows into the
 * internal store, then rewrites `edge`/`launch_intent` keys from recordId → the new task uuid.
 *
 * Guarded so it runs at most once and only when there is no internal task data yet (fresh installs
 * with no Feishu source just mark themselves migrated and configure sources via Settings). Adapter is
 * injectable for tests.
 */
export async function migrateIdentitiesOnce(
  store: Store,
  ctx: AdapterContext,
  adapterFor: (kind: string) => DataSourceAdapter = getAdapter,
  now: Now = Date.now,
): Promise<void> {
  if (store.getSetting('migrated')) return
  if (store.allTasks(true).length > 0) { store.setSetting('migrated', '1'); return }

  const primary = store.allDataSources().find(s => s.enabled && s.kind === 'feishu-bitable')
  if (!primary) { store.setSetting('migrated', '1'); return }   // fresh install, nothing to migrate

  const adapter = adapterFor(primary.kind)
  let records
  try { records = await adapter.pullTasks(primary, ctx) }
  catch { return }   // leave unmigrated so a later boot can retry once the source is reachable

  const recordToTask = new Map<string, string>()
  const t = now()
  for (const rec of records) {
    const id = randomUUID()
    store.insertTask({ id, ...rec.fields, projectId: null, updatedAt: t, syncedAt: t, deleted: false })
    store.putRef({ entityKind: 'task', entityId: id, sourceId: primary.id, externalId: rec.externalId, externalHash: rec.hash, externalUpdatedAt: rec.externalUpdatedAt ?? null })
    recordToTask.set(rec.externalId, id)
  }

  if (adapter.pullProjects) {
    try { for (const p of await adapter.pullProjects(primary, ctx)) store.upsertProject(p) } catch { /* projects best-effort */ }
  }

  // rewrite identity-sensitive keys (the only tables that stored recordIds)
  for (const [oldKey, newKey] of recordToTask) {
    store.rewriteEdgeKey(oldKey, newKey)
    store.rewriteIntentKey(oldKey, newKey)
  }

  store.setSetting('migrated', '1')
}
