import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openStore } from '../db/store'
import { collectLogicalSessions, filterImportedSessions, curatedSessionIds as computeCuratedIds } from '../sessions'
import { reconcileLaunchIntents } from './reconcile'
import { ensureBootstrap } from '../data/bootstrap'
import { seedOnboarding } from '../data/onboarding'
import { migrateIdentitiesOnce } from '../data/migrate'
import { migrateAttachmentsOnce } from '../data/migrate-assets'
import { migrateSessionDirsOnce } from '../data/migrate-session-dirs'
import { migrateSessionImportOnce } from '../data/migrate-session-import'
import { getDocsRoot, getDocStore, setDocStoreStore } from '../data/docstore'
import { getLocale } from '../i18n'
import { getContextConfig } from '../data/context-config'
import { setDocGitEnabled } from '../data/doc-git'
import { syncSource } from '../data/sync/engine'
import { setTaskSessionDigestProvider } from '../data/task-summary'
import { readTranscript } from './context-consolidate-service'
import { extractConversation } from '../agent/transcript'
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

// Let the data-layer task summarizer reach the in-memory session cache (which only the server knows
// about) without a data→server import: for each session linked to the task (edges), read its raw
// transcript and distill it to a conversation digest (user queries + agent textual replies; tool
// calls / thinking / artifacts dropped), accumulated up to `budget` chars total in edge order.
setTaskSessionDigestProvider((s, taskId, budget) => {
  const sessionIds = s.edgesByTodo().get(taskId) ?? []
  if (!sessionIds.length) return ''
  const parts: string[] = []
  let used = 0
  for (const sid of sessionIds) {
    const remaining = budget - used
    if (remaining <= 0) break
    const sess = cache.find(x => x.sessionId === sid)
    if (!sess?.contentSourcePath) continue
    const digest = extractConversation(readTranscript(sess.contentSourcePath), remaining).trim()
    if (!digest) continue
    parts.push(digest)
    used += digest.length
  }
  return parts.join('\n\n')
})

/**
 * One-time async data init, run ONLY at real server startup (see start()): first-run bootstrap
 * (seed data sources + docsRoot from the local untracked seed) then the recordId→uuid identity
 * migration. Kept out of module-load so importing the singleton in tests never writes to the DB.
 * Both steps are guarded internally, so repeat calls are no-ops.
 */
export async function initData(): Promise<void> {
  ensureBootstrap(store)
  // Seed the onboarding guide for anyone who has not been SHOWN it yet — including existing installs
  // upgrading into this version (there are few old users, so a one-time backfill is fine). seedOnboarding
  // self-guards on the `onboarding-seeded` flag, which is set the moment it seeds, so once a user has
  // seen the guide it never returns — not even if they manually delete the project (deletion ≠ unshown).
  try { seedOnboarding(store, getDocStore(store), getLocale(store)) }
  catch { /* onboarding is best-effort; never block server startup */ }
  await migrateIdentitiesOnce(store, { docsRoot: getDocsRoot(store) })
  migrateAttachmentsOnce(store, { docsRoot: getDocsRoot(store) })
  migrateSessionDirsOnce(store)
  // M3: seed session_import from the OLD visible set so nothing vanishes when project_path /
  // launch_intent stop being import roots. Needs a real disk scan (LogicalSession[]), not the cache.
  // Guard the scan at the call site so we don't pay a full 3-store disk scan on every boot post-migration.
  if (!store.getSetting('session-import-migrated'))
    migrateSessionImportOnce(store, collectLogicalSessions(storeRoots()))
}

/**
 * Session-import roots — now ONLY explicit `session_import_dir` directories (the old vanilla app's
 * 导入目录, still supported). `project_path` (货舱) and `launch_intent.cwd` are deliberately NOT roots
 * anymore: registering a 货舱 cwd must not surface all its sessions (会话粒度导入, see spec
 * 2026-06-17), and Berth-launched sessions surface per-session via `allBoundLaunchSessionIds`.
 *
 * `berthAgentCwd()` is likewise not a root — the internal management agent's headless one-shots stay
 * hidden from the list (gotcha #7).
 */
function importRoots(): string[] {
  return store.allSessionImportDirs()
}

/**
 * Session ids that are curated — always kept regardless of cwd: pinned, edged, attached to a **real
 * project**, explicitly session-imported, or a bound Berth launch. (A project-less attach marker does
 * NOT curate — see `curatedSessionIds`.)
 */
function curatedSessionIds(): Set<string> {
  return computeCuratedIds(
    store.allPinnedSet(),
    store.allAttachMap(),
    store.edgesByTodo().values(),
    store.allSessionImportSet(),
    store.allBoundLaunchSessionIds(),
  )
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
  cache = filterImportedSessions(all, importRoots(), curatedSessionIds(), store.allHiddenSessionSet())
  store.upsertSessions(cache)
  // Reconcile over the UNFILTERED scan, not `cache`: a fresh codex launch is bound=0 / unattached /
  // not yet session-imported, and its cwd is no longer an import root — so it's absent from `cache`.
  // Passing `cache` would mean reconcile never finds it → never binds → never surfaces (deadlock).
  // reconcile constrains candidates by intent cwd/cli/time internally, so the wider input is safe;
  // once bound it enters allBoundLaunchSessionIds → curated → surfaces on the next refresh.
  const bound = reconcileLaunchIntents(store, all)
  if (bound > 0) {
    cache = filterImportedSessions(all, importRoots(), curatedSessionIds(), store.allHiddenSessionSet())
    store.upsertSessions(cache)
  }
  // Auto-pull sources configured for it (default is manual → no-op). Fire-and-forget; never blocks.
  for (const s of store.allDataSources()) {
    if (s.enabled && s.pullMode === 'auto') {
      void syncSource(store, s, { docsRoot: getDocsRoot(store) }, { push: false }).catch(() => {})
    }
  }
  return cache
}
