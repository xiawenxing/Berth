import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openStore } from '../db/store'
import { collectLogicalSessions, filterImportedSessions } from '../sessions'
import { reconcileLaunchIntents } from './reconcile'
import { ensureBootstrap } from '../data/bootstrap'
import { migrateIdentitiesOnce } from '../data/migrate'
import { migrateAttachmentsOnce } from '../data/migrate-assets'
import { migrateSessionDirsOnce } from '../data/migrate-session-dirs'
import { getDocsRoot, setDocStoreStore } from '../data/docstore'
import { syncSource } from '../data/sync/engine'
import { berthHome } from '../paths'
import type { LogicalSession } from '../types'

const DB_DIR = berthHome()
mkdirSync(DB_DIR, { recursive: true })
const store = openStore(join(DB_DIR, 'berth.sqlite'))

// Register the store so DocStore consumers far from here (pty-registry) can resolve docsRoot.
// (Pure reference registration — no DB writes, so importing this module never mutates state.)
setDocStoreStore(store)

let cache: LogicalSession[] = []

export function getStore() { return store }
export function getCache(): LogicalSession[] { return cache }

/**
 * One-time async data init, run ONLY at real server startup (see start()): first-run bootstrap
 * (seed data sources + docsRoot from the local untracked seed) then the recordId→uuid identity
 * migration. Kept out of module-load so importing the singleton in tests never writes to the DB.
 * Both steps are guarded internally, so repeat calls are no-ops.
 */
export async function initData(): Promise<void> {
  ensureBootstrap(store)
  await migrateIdentitiesOnce(store, { docsRoot: getDocsRoot(store) })
  migrateAttachmentsOnce(store, { docsRoot: getDocsRoot(store) })
  migrateSessionDirsOnce(store)
}

/** Gather the session-import roots: explicitly imported dirs ∪ project paths ∪ launch-intent cwds. */
function importRoots(): string[] {
  const roots = new Set<string>(store.allSessionImportDirs())
  for (const { paths } of store.allProjectPaths().values()) for (const p of paths) roots.add(p)
  for (const cwd of store.allLaunchIntentCwds()) roots.add(cwd)
  return [...roots]
}

/** Session ids that are curated (attached / edged / pinned) — always kept regardless of cwd. */
function curatedSessionIds(): Set<string> {
  const ids = new Set<string>(store.allPinnedSet())
  for (const id of store.allAttachMap().keys()) ids.add(id)
  for (const sids of store.edgesByTodo().values()) for (const id of sids) ids.add(id)
  return ids
}

/**
 * Re-scan all 3 CLI stores, restrict to imported directories, persist identity rows, refresh the
 * in-memory cache. The scanned universe is sessions whose cwd is under an import root (∪ curated
 * sessions) — NOT every session in the CLI stores. See `filterImportedSessions`.
 */
export function refresh(): LogicalSession[] {
  const all = collectLogicalSessions({
    claudeRoot: join(homedir(), '.claude', 'projects') + '/',
    codexRoot: join(homedir(), '.codex') + '/',
    cocoRoot: join(homedir(), 'Library', 'Caches', 'coco') + '/',
  })
  cache = filterImportedSessions(all, importRoots(), curatedSessionIds())
  store.upsertSessions(cache)
  reconcileLaunchIntents(store, cache)
  // Auto-pull sources configured for it (default is manual → no-op). Fire-and-forget; never blocks.
  for (const s of store.allDataSources()) {
    if (s.enabled && s.pullMode === 'auto') {
      void syncSource(store, s, { docsRoot: getDocsRoot(store) }, { push: false }).catch(() => {})
    }
  }
  return cache
}
