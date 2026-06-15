type Store = ReturnType<typeof import('../db/store').openStore>

/**
 * One-time backfill of `session_import_dir` when the app moves from "scan all CLI sessions" to the
 * directory-import model. On an existing install we seed the import list with the distinct cwds of
 * sessions the owner already attached to a project, so their current view doesn't empty out. Project
 * paths and launch-intent cwds are already implicit roots (see store-singleton.importRoots), so they
 * need no backfill. Fresh installs have no attachments → nothing is seeded → the session list starts
 * empty and the user imports a directory explicitly.
 *
 * Guarded by the `session-dirs-migrated` setting so it runs exactly once. Returns the count seeded.
 */
export function migrateSessionDirsOnce(store: Store): number {
  if (store.getSetting('session-dirs-migrated')) return 0
  const attached = store.allAttachMap()
  const sessions = store.allSessions() as Array<{ session_id: string; cwd: string | null }>
  const dirs = new Set<string>()
  for (const s of sessions) {
    if (s.cwd && attached.has(s.session_id)) dirs.add(s.cwd)
  }
  for (const cwd of dirs) store.addSessionImportDir(cwd)
  store.setSetting('session-dirs-migrated', '1')
  return dirs.size
}
