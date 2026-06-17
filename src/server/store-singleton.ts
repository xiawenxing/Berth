import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openStore } from '../db/store'
import { collectLogicalSessions, filterImportedSessions, curatedSessionIds as computeCuratedIds } from '../sessions'
import { reconcileLaunchIntents } from './reconcile'
import { ensureBootstrap } from '../data/bootstrap'
import { migrateIdentitiesOnce } from '../data/migrate'
import { migrateAttachmentsOnce } from '../data/migrate-assets'
import { migrateSessionDirsOnce } from '../data/migrate-session-dirs'
import { getDocsRoot, setDocStoreStore } from '../data/docstore'
import { getContextConfig } from '../data/context-config'
import { setDocGitEnabled } from '../data/doc-git'
import { syncSource } from '../data/sync/engine'
import { berthHome } from '../paths'
import type { LogicalSession } from '../types'

const DB_DIR = berthHome()
mkdirSync(DB_DIR, { recursive: true })
const store = openStore(join(DB_DIR, 'berth.sqlite'))

// Register the store so DocStore consumers far from here (pty-registry) can resolve docsRoot.
// (Pure reference registration — no DB writes, so importing this module never mutates state.)
setDocStoreStore(store)
setDocGitEnabled(getContextConfig(store).gitEnabled)

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

/**
 * Gather the session-import roots: explicit dirs ∪ project paths ∪ launch-intent cwds.
 *
 * NOTE: `berthAgentCwd()` is deliberately NOT a root. The internal management agent (`claude -p` for
 * AI titles / progress summaries) runs there and would otherwise surface its headless one-shot
 * sessions in the 无归属 list as noise. These never block and never need user action, so they are
 * hidden from the list rather than kept as a "Berth activity" log (the earlier choice — reversed).
 */
function importRoots(): string[] {
  const roots = new Set<string>(store.allSessionImportDirs())
  for (const { paths } of store.allProjectPaths().values()) for (const p of paths) roots.add(p)
  for (const cwd of store.allLaunchIntentCwds()) roots.add(cwd)
  return [...roots]
}

/**
 * Session ids that are curated — always kept regardless of cwd. Pinned, edged to a task, or attached
 * to a **real project**; a project-less attach marker does NOT curate (see `curatedSessionIds`).
 */
function curatedSessionIds(): Set<string> {
  return computeCuratedIds(store.allPinnedSet(), store.allAttachMap(), store.edgesByTodo().values())
}

/**
 * The CLI store roots scanned by `collectLogicalSessions`. Centralized so both `refresh()` and the
 * preview endpoint (which scans without mutating state) agree on exactly which stores to read.
 */
export function storeRoots(): { claudeRoot: string; codexRoot: string; cocoRoot: string } {
  return {
    claudeRoot: join(homedir(), '.claude', 'projects') + '/',
    codexRoot: join(homedir(), '.codex') + '/',
    cocoRoot: join(homedir(), 'Library', 'Caches', 'coco') + '/',
  }
}

/**
 * Re-scan all 3 CLI stores, restrict to imported directories, persist identity rows, refresh the
 * in-memory cache. The scanned universe is sessions whose cwd is under an import root (∪ curated
 * sessions) — NOT every session in the CLI stores. See `filterImportedSessions`.
 */
export function refresh(): LogicalSession[] {
  const all = collectLogicalSessions(storeRoots())
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
