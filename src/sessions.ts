import { listClaudeSessions } from './adapters/claude'
import { listCodexSessions, loadImportLedger } from './adapters/codex'
import { listCocoSessions } from './adapters/coco'
import { mergeSessions } from './dedup/identity'
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

/** Normalize a directory path for matching: drop a single trailing slash (but keep root "/"). */
function normDir(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
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
