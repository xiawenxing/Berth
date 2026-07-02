import type { AgentCli, LogicalSession } from '../types'

/**
 * Pure projection + selection helpers behind the 导入会话 chooser endpoints. They operate on an
 * already-scanned `LogicalSession[]` (from `collectLogicalSessions(storeRoots())`) so the HTTP
 * handlers stay thin and the selection logic is unit-testable without the scan/HTTP layers.
 */
export interface PreviewSession {
  sessionId: string
  cli: AgentCli
  title: string | null
  cwd: string | null
  updatedAt: number
}

/**
 * Project to a PreviewSession. `overrides` is the Berth rename map (sessionId→title): a Berth-named
 * session wins over its native/derived title, matching the main list's precedence so the 导入 chooser
 * shows the same name (berth名 > 原生 > 推断).
 */
export function toPreview(s: LogicalSession, overrides?: Map<string, string>): PreviewSession {
  return { sessionId: s.sessionId, cli: s.cli, title: overrides?.get(s.sessionId) ?? s.title ?? null, cwd: s.cwd ?? null, updatedAt: s.updatedAt }
}

/** All sessions for one CLI, most-recent first. */
export function previewByCli(all: LogicalSession[], cli: AgentCli, overrides?: Map<string, string>): PreviewSession[] {
  return all
    .filter(s => s.cli === cli)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(s => toPreview(s, overrides))
}

/**
 * Split requested ids into the sessions that exist in the scan vs the ids that don't. `found`
 * preserves the request order (deduped); `notFound` lists the leftover ids (deduped, request order).
 */
export function previewByIds(all: LogicalSession[], ids: string[], overrides?: Map<string, string>): { found: PreviewSession[]; notFound: string[] } {
  const byId = new Map(all.map(s => [s.sessionId, s]))
  const seen = new Set<string>()
  const found: PreviewSession[] = []
  const notFound: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const s = byId.get(id)
    if (s) found.push(toPreview(s, overrides))
    else notFound.push(id)
  }
  return { found, notFound }
}
