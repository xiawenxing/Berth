import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectLogicalSessions, filterImportedSessions, curatedSessionIds } from '../src/sessions'
import type { LogicalSession } from '../src/types'

function mk(id: string, cwd: string | null): LogicalSession {
  return { sessionId: id, cli: 'claude', cwd, title: null, updatedAt: 0, contentSourcePath: null, copies: [], deleted: false }
}

const FX = new URL('./fixtures/', import.meta.url).pathname

describe('collectLogicalSessions', () => {
  // Expected count = 4, NOT 3.
  //
  // The fixtures were NOT authored so that the codex import-stub's source_path
  // (/Users/me/.claude/projects/enc/cccc1111.jsonl) matches the claude fixture's
  // store path (test/fixtures/claude/projects/enc-cwd/cccc1111-1111-4111-8111-111111111111.jsonl).
  // The paths differ both in directory and UUID format, so mergeSessions cannot
  // join them via path lookup; the stub stays a standalone codex import-stub
  // (deleted, because the source_path does not exist on disk).
  //
  // The "2 copies" session is the claude native (cccc1111...) which has its
  // subagent (agent-aaa.jsonl) folded into it — NOT a cross-CLI merged pair.
  //
  // Fixture inventory:
  //   - claude native:        cccc1111-...  + subagent folded in → copies.length === 2 (1 logical)
  //   - codex native:         019ea000-...0001  (1 logical)
  //   - codex import-stub:    019ea000-...0002  standalone/deleted (1 logical, sessionId = normed source path)
  //   - coco native:          6d5e72ab-...  (1 logical)
  //   → 4 logical sessions total
  it('merges all 3 fixture stores and dedups the imported pair', () => {
    const all = collectLogicalSessions({
      claudeRoot: FX + 'claude/projects/',
      codexRoot: FX + 'codex/',
      cocoRoot: FX + 'coco/',
    })

    // 4 logical sessions: claude native + codex native + codex import-stub (deleted/standalone) + coco
    expect(all).toHaveLength(4)

    // One session has 2 copies: the claude native with its subagent folded in.
    // The copies.length===2 is NOT a cross-CLI merge; it's the parent+subagent fold.
    expect(all.filter(s => s.copies.length === 2)).toHaveLength(1)
    const withSubagent = all.find(s => s.copies.length === 2)!
    expect(withSubagent.copies.some(c => c.kind === 'subagent')).toBe(true)

    // The import-stub is marked deleted because /Users/me/.claude/projects/enc/cccc1111.jsonl
    // does not exist on disk, and no matching claude peer was found by path
    const stub = all.find(s => s.copies.some(c => c.kind === 'import-stub'))!
    expect(stub).toBeDefined()
    expect(stub.deleted).toBe(true)
    expect(stub.contentSourcePath).toBe(null)

    // All non-deleted sessions must have a contentSourcePath
    for (const s of all) {
      if (!s.deleted) expect(s.contentSourcePath).toBeTruthy()
    }
  })
})

describe('filterImportedSessions', () => {
  const sessions = [
    mk('a', '/Users/me/proj-a'),
    mk('b', '/Users/me/proj-a/sub'),   // nested under proj-a
    mk('c', '/Users/me/proj-b'),
    mk('d', '/Users/me/proj-ab'),      // sibling that shares a prefix string
    mk('e', null),
  ]
  const empty = new Set<string>()

  it('keeps ONLY sessions whose cwd equals an import root — NOT nested subdirectories', () => {
    const kept = filterImportedSessions(sessions, ['/Users/me/proj-a'], empty).map(s => s.sessionId)
    expect(kept).toEqual(['a'])   // 'b' (a/sub) is excluded; 'd' (proj-ab) is excluded
  })

  it('importing a parent does NOT pull in its subdirectory tree', () => {
    const kept = filterImportedSessions(sessions, ['/Users/me'], empty).map(s => s.sessionId)
    expect(kept).toEqual([])   // no session's cwd is exactly /Users/me
  })

  it('matches multiple roots and is trailing-slash tolerant', () => {
    const kept = filterImportedSessions(sessions, ['/Users/me/proj-a/', '/Users/me/proj-b'], empty).map(s => s.sessionId)
    expect(kept).toEqual(['a', 'c'])
  })

  it('matches cwd and import roots that resolve to the same real directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'berth-path-'))
    try {
      const real = join(tmp, 'real')
      const alias = join(tmp, 'alias')
      mkdirSync(real)
      symlinkSync(real, alias, 'dir')
      expect(filterImportedSessions([mk('alias-session', alias)], [real], empty).map(s => s.sessionId))
        .toEqual(['alias-session'])
      expect(filterImportedSessions([mk('real-session', real)], [alias], empty).map(s => s.sessionId))
        .toEqual(['real-session'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('includes a subdirectory only when it is imported explicitly', () => {
    const kept = filterImportedSessions(sessions, ['/Users/me/proj-a', '/Users/me/proj-a/sub'], empty).map(s => s.sessionId)
    expect(kept).toEqual(['a', 'b'])
  })

  it('drops everything when there are no roots', () => {
    expect(filterImportedSessions(sessions, [], empty)).toEqual([])
  })

  it('keeps curated (attached/edged/pinned) sessions regardless of cwd, including null cwd', () => {
    const kept = filterImportedSessions(sessions, [], new Set(['c', 'e'])).map(s => s.sessionId)
    expect(kept).toEqual(['c', 'e'])
  })

  it('null-cwd sessions are never matched by a root (only via the curated net)', () => {
    const kept = filterImportedSessions([mk('x', null)], ['/Users/me'], empty)
    expect(kept).toEqual([])
  })
})

describe('curatedSessionIds', () => {
  const attach = (...rows: Array<[string, string | null]>) =>
    new Map(rows.map(([id, projectId]) => [id, { projectId }]))

  it('curates pinned, edged, and real-project attaches', () => {
    const ids = curatedSessionIds(['pin1'], attach(['att1', 'projA']), [['edge1', 'edge2']])
    expect([...ids].sort()).toEqual(['att1', 'edge1', 'edge2', 'pin1'])
  })

  it('does NOT curate a project-less attach (the "(NO CWD)" ghost bug)', () => {
    // A Berth plain-launch wrote setAttach(id, null, 'confirmed'); that marker must not curate, else
    // a null-cwd session is force-kept and surfaces under a phantom "(NO CWD)" group.
    const ids = curatedSessionIds([], attach(['ghost', null], ['empty', ''], ['real', 'projB']), [])
    expect([...ids]).toEqual(['real'])
  })

  it('a null-cwd, project-less-attached session is filtered out (regression)', () => {
    const sessions = [mk('ghost', null)]
    const curated = curatedSessionIds([], attach(['ghost', null]), [])
    expect(filterImportedSessions(sessions, ['/Users/me'], curated)).toEqual([])
  })
})
