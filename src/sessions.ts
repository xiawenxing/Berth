import { listClaudeSessions } from './adapters/claude'
import { listCodexSessions, loadImportLedger } from './adapters/codex'
import { listCocoSessions } from './adapters/coco'
import { mergeSessions } from './dedup/identity'
import { canonicalPathKey } from './path-normalize'
import type { LogicalSession } from './types'

export interface StoreRoots { claudeRoot: string; codexRoot: string; cocoRoot: string }

export function collectLogicalSessions(roots: StoreRoots): LogicalSession[] {
  const physical = [
    ...listClaudeSessions(roots.claudeRoot),
    ...listCodexSessions(roots.codexRoot),
    ...listCocoSessions(roots.cocoRoot),
  ]
  return mergeSessions(physical, loadImportLedger(roots.codexRoot))
}

/** Normalize a directory path for matching: resolve symlinks when possible and drop trailing slash. */
function normDir(p: string): string {
  const key = canonicalPathKey(p)
  return key.length > 1 ? key.replace(/\/+$/, '') : key
}

/**
 * Compute the curated set: sessions that are always kept regardless of cwd because the user has
 * explicitly organized them — pinned, edged to a task, or attached to a **real project**.
 *
 * A null/empty-project attach does NOT curate. Berth-launched plain sessions (no project, no task)
 * used to write a `setAttach(id, null, 'confirmed')` marker; that marker has no consumer (the
 * frontend never reads `attachState`) but, when treated as curated, it force-kept the session even
 * with a null cwd — surfacing it under a phantom "(NO CWD)" group during the CLI's init window or
 * forever if the session never materialized. Curation requires a genuine organizing signal, so a
 * project-less attach is inert here. A session with no real cwd then only appears once its cwd lands
 * inside an import root (incl. its own launch-intent cwd).
 */
export function curatedSessionIds(
  pinned: Iterable<string>,
  attachMap: Map<string, { projectId: string | null }>,
  edges: Iterable<string[]>,
  sessionImport: Iterable<string> = [],
  boundLaunch: Iterable<string> = [],
): Set<string> {
  const ids = new Set<string>(pinned)
  for (const [id, a] of attachMap) if (a.projectId) ids.add(id)
  for (const sids of edges) for (const id of sids) ids.add(id)
  // Session-grained import: the new canonical surfacing signal (registering a 货舱 cwd no longer
  // surfaces all its sessions — only those explicitly imported land here).
  for (const id of sessionImport) ids.add(id)
  // Berth-launched sessions surface per-session (was: launch_intent.cwd as a directory-wide root).
  for (const id of boundLaunch) ids.add(id)
  return ids
}

/**
 * Restrict the scanned-session universe to imported directories. A session is kept when its `cwd`
 * **equals** an import `root` exactly (NOT recursively — importing a directory brings in the sessions
 * that ran in that directory, not every session in its subdirectory tree), OR it is curated (attached
 * / edged / pinned) — the safety net so explicitly-organized sessions never vanish when import dirs
 * narrow. Sessions with a null cwd are kept only via the curated safety net. To include a
 * subdirectory's sessions, import that subdirectory too.
 */
export function filterImportedSessions(
  sessions: LogicalSession[],
  roots: string[],
  curatedIds: Set<string>,
): LogicalSession[] {
  const rootSet = new Set(roots.map(normDir))
  return sessions.filter(s =>
    curatedIds.has(s.sessionId) ||
    (s.cwd != null && rootSet.has(normDir(s.cwd))),
  )
}
