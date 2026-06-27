import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PhysicalSession, LedgerRecord, LogicalSession } from '../types'

// Normalize a path so byte-different-but-equivalent paths (./, .., trailing, NFC) join correctly.
function normKey(p: string): string { return resolve(p).normalize('NFC') }

// A Claude transcript path is `<root>/<UUID>.jsonl`, and the Claude adapter uses that UUID as its
// physicalId. Recover it from the import source path so an import stub keeps the SAME logical id as
// its Claude source whether or not the Claude file is still on disk. Otherwise an orphaned stub falls
// back to the filesystem path, which orphans everything keyed on sessionId (title_override → the
// session shows "(未命名)" instead of its renamed title; also pins/attach/todo edges).
const CLAUDE_UUID_PATH = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
function claudeIdFromPath(p: string): string | null { return p.match(CLAUDE_UUID_PATH)?.[1] ?? null }

/**
 * Merge physical sessions into logical ones.
 * Rules: ledger is the ONLY join key; collapse is DIRECTIONAL (Claude file =
 * canonical content, Codex import = frozen resume pointer); subagents fold into
 * parent; index/sha never used as merge keys. Order-independent.
 */
export function mergeSessions(
  physical: PhysicalSession[],
  ledger: LedgerRecord[],
  claudePathByCodexPath: Record<string, string> = {},
): LogicalSession[] {
  const byClaudePath = new Map<string, PhysicalSession>()
  for (const p of physical) if (p.cli === 'claude' && p.kind === 'native') byClaudePath.set(normKey(p.storePath), p)

  const sourceByImported = new Map<string, string>()
  for (const r of ledger) sourceByImported.set(r.importedThreadId, r.sourcePath)

  const logicals = new Map<string, LogicalSession>()
  const importMerged = new Set<string>()   // canonicalIds established directionally by an import stub
  const subagents = physical.filter(p => p.kind === 'subagent')

  for (const p of physical) {
    if (p.kind === 'subagent') continue

    const srcPath = p.kind === 'import-stub'
      ? (p.importedFromPath ?? sourceByImported.get(p.physicalId) ?? claudePathByCodexPath[p.storePath])
      : undefined

    if (p.kind === 'import-stub' && srcPath) {
      const claude = byClaudePath.get(normKey(srcPath))
      const canonicalId = claude?.physicalId ?? claudeIdFromPath(srcPath) ?? normKey(srcPath)
      const contentPath = claude?.storePath ?? srcPath        // prefer the real Claude file when known
      const alive = existsSync(contentPath)
      const L = logicals.get(canonicalId) ?? blank(canonicalId)
      L.cli = 'claude'
      L.contentSourcePath = alive ? contentPath : null
      L.deleted = !alive
      L.cwd = claude?.cwd ?? p.cwd ?? L.cwd
      L.title = claude?.title ?? L.title
      L.updatedAt = Math.max(L.updatedAt, claude?.updatedAt ?? 0, p.updatedAt)
      L.resume = { cli: 'codex', id: p.physicalId }           // always the imported Codex thread
      if (!L.copies.includes(p)) L.copies.push(p)
      if (claude && !L.copies.includes(claude)) L.copies.push(claude)
      importMerged.add(canonicalId)
      logicals.set(canonicalId, L)
      continue
    }

    const canonicalId = p.physicalId
    const L = logicals.get(canonicalId) ?? blank(canonicalId)
    if (importMerged.has(canonicalId)) {
      // Directionally established by a stub; never clobber content/resume — just attach the copy.
      L.cwd = L.cwd ?? p.cwd
      L.title = L.title ?? p.title
      L.updatedAt = Math.max(L.updatedAt, p.updatedAt)
      if (!L.copies.includes(p)) L.copies.push(p)
      logicals.set(canonicalId, L)
      continue
    }
    L.cli = p.cli
    L.cwd = L.cwd ?? p.cwd
    L.title = L.title ?? p.title
    L.updatedAt = Math.max(L.updatedAt, p.updatedAt)
    L.contentSourcePath = existsSync(p.storePath) ? p.storePath : null
    L.deleted = L.contentSourcePath === null
    L.resume = L.resume ?? { cli: p.cli, id: p.physicalId }
    if (!L.copies.includes(p)) L.copies.push(p)
    logicals.set(canonicalId, L)
  }

  for (const s of subagents) {
    const parent = logicals.get(s.parentId!)
    if (parent) parent.copies.push(s)
  }

  return [...logicals.values()]
}

function blank(id: string): LogicalSession {
  return { sessionId: id, cli: 'claude', cwd: null, title: null, updatedAt: 0,
    contentSourcePath: null, copies: [], deleted: false }
}
