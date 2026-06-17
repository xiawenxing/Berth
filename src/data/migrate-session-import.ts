import { filterImportedSessions, curatedSessionIds } from '../sessions'
import type { LogicalSession } from '../types'

type Store = ReturnType<typeof import('../db/store').openStore>

/**
 * One-time backfill of `session_import` when the surfacing model moves from directory-grained
 * (cwd ∈ importRoots) to session-grained (explicit `session_import` set). On an existing install we
 * seed `session_import` with **exactly the set the OLD rule made visible**, so the user's current
 * view doesn't shrink when `project_path` / `launch_intent.cwd` stop being import roots.
 *
 * The OLD rule is reconstructed here verbatim:
 *   roots   = session_import_dir ∪ project_path.cwd ∪ launch_intent.cwd
 *   curated = pin ∪ attach(real project) ∪ edge      (the 3-arg curatedSessionIds — no session_import,
 *                                                      no bound-launch, since those didn't gate then)
 *
 * Input MUST be real `LogicalSession[]` (sessionId camelCase) from a fresh disk scan — NOT
 * `store.allSessions()` (which returns snake_case sqlite rows; `s.sessionId` would be undefined).
 *
 * Guarded by `session-import-migrated`; the flag is set ONLY after the full loop, so a mid-migration
 * failure safely retries next boot rather than half-seeding and locking out.
 */
export function migrateSessionImportOnce(store: Store, all: LogicalSession[]): number {
  if (store.getSetting('session-import-migrated')) return 0
  const oldRoots = new Set<string>(store.allSessionImportDirs())
  for (const { paths } of store.allProjectPaths().values()) for (const p of paths) oldRoots.add(p)
  for (const cwd of store.allLaunchIntentCwds()) oldRoots.add(cwd)
  const oldCurated = curatedSessionIds(store.allPinnedSet(), store.allAttachMap(), store.edgesByTodo().values())
  const visible = filterImportedSessions(all, [...oldRoots], oldCurated)
  for (const s of visible) store.addSessionImport(s.sessionId)
  store.setSetting('session-import-migrated', '1')
  return visible.length
}
