import { listClaudeSessions } from './adapters/claude'
import { listCodexSessions, loadImportLedger } from './adapters/codex'
import { listCocoSessions } from './adapters/coco'
import { mergeSessions } from './dedup/identity'
import { canonicalPathKey } from './path-normalize'
import type { LogicalSession, LaunchIntent } from './types'

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
  hiddenIds: Set<string> = new Set(),
): LogicalSession[] {
  const rootSet = new Set(roots.map(normDir))
  return sessions.filter(s =>
    !hiddenIds.has(s.sessionId) && (
      curatedIds.has(s.sessionId) ||
      (s.cwd != null && rootSet.has(normDir(s.cwd)))
    ),
  )
}

/**
 * The session-visibility model has two arms; `filterImportedSessions` above is the **disk arm** (a
 * registered/imported session, resolved from the on-disk scan). This is the **live-PTY arm**: an
 * in-flight Berth launch whose CLI hasn't written its jsonl yet (a jsonl needs a completed turn), so
 * it's absent from the disk scan. Without it, closing the drawer / reloading the page would strand a
 * running-but-unlisted agent (the "wedged in 创建中, lost on reload" bug).
 *
 * We synthesize a transient `LogicalSession` for each launch intent that (a) has a LIVE pty — gate, so
 * a dead launch shows no non-recoverable ghost — and (b) isn't already on disk (the real row wins the
 * moment the jsonl lands). Keyed by the **launch key**: the minted sessionId for claude/coco, or the
 * intent id for codex (whose real id is unknown until reconcile — so this arm covers codex pre-bind
 * too, which the curated set alone does NOT). These rows are NEVER persisted; they live only in the
 * in-memory visible set. Pure (hasLivePty injected).
 */
export function synthLaunchingSessions(
  intents: LaunchIntent[],
  onDiskIds: Set<string>,
  hasLivePty: (key: string) => boolean,
): LogicalSession[] {
  const out: LogicalSession[] = []
  const seen = new Set<string>()
  for (const i of intents) {
    const key = i.sessionId ?? i.id
    if (onDiskIds.has(key) || seen.has(key) || !hasLivePty(key)) continue
    seen.add(key)
    out.push({
      sessionId: key, cli: i.cli, cwd: i.cwd, title: null,
      updatedAt: i.createdAt, contentSourcePath: null, copies: [], deleted: false, launching: true,
    })
  }
  return out
}
