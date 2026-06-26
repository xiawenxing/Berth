import { shortCwd } from './format'
import type { CwdGroup } from './types'
import type { ApiPathMeta } from './api'

/** Trailing-slash-tolerant cwd key (mirrors ProjectWorkspace's local `norm`). */
export function normCwd(p: string): string {
  return p.replace(/\/+$/, '')
}

/**
 * Registered 装载目录 (货舱) that currently have NO project session, surfaced as empty
 * `CwdGroup`s so they still appear in the 会话 list with a per-directory 导入 entry point.
 *
 * Pure + tested. Append these AFTER the session-derived groups (and after 主上下文 is chosen),
 * so an empty registered dir can never be mislabeled as 主上下文.
 *
 * - `pathsMeta` — all registered cargo dirs ({cwd, enabled}); `enabled` is IGNORED (it only governs
 *   default-load at launch, orthogonal to "has an import entry point").
 * - `sessionCwds` — RAW cwds already represented by a session-bearing group (keys of the group map).
 * - `workspaceCwd` — the masked Berth default dir; excluded (it's always shown as its own group).
 */
export function emptyCargoGroups(
  pathsMeta: ApiPathMeta[] | undefined,
  sessionCwds: Iterable<string>,
  workspaceCwd?: string,
): CwdGroup[] {
  const taken = new Set<string>()
  for (const c of sessionCwds) taken.add(normCwd(c))
  const wsNorm = workspaceCwd ? normCwd(workspaceCwd) : null
  const out: CwdGroup[] = []
  const seen = new Set<string>()
  for (const p of pathsMeta ?? []) {
    const n = normCwd(p.cwd)
    if (n === wsNorm) continue // masked workspace dir is shown separately
    if (taken.has(n)) continue // already a session-bearing group
    if (seen.has(n)) continue // de-dup duplicate registrations
    seen.add(n)
    out.push({
      key: p.cwd,
      cwd: shortCwd(p.cwd),
      tag: '装载目录',
      shortTag: '装载目录',
      sessions: [],
      kind: 'cwd',
      rawCwd: p.cwd,
    })
  }
  return out
}
