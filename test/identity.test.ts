import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeSessions } from '../src/dedup/identity'
import type { PhysicalSession, LedgerRecord } from '../src/types'

vi.mock('node:fs', async (o) => ({ ...(await o() as object), existsSync: vi.fn(() => true) }))
beforeEach(async () => { const fs = await import('node:fs'); (fs.existsSync as any).mockImplementation(() => true) })

const claude: PhysicalSession = { cli:'claude', physicalId:'cccc1111-1111-4111-8111-111111111111',
  storePath:'/Users/me/.claude/projects/enc/cccc1111-1111-4111-8111-111111111111.jsonl', cwd:'/Users/me/Code/y', title:'real talk',
  updatedAt: 200, kind:'native' }
const codexStub: PhysicalSession = { cli:'codex', physicalId:'019ea000-0000-7000-8000-000000000002',
  storePath:'/Users/me/.codex/sessions/...0002.jsonl', cwd:'/Users/me/Code/y', title:null,
  updatedAt: 150, kind:'import-stub', importedFromPath:'/Users/me/.claude/projects/enc/cccc1111-1111-4111-8111-111111111111.jsonl' }
const codexNative: PhysicalSession = { cli:'codex', physicalId:'019ea000-0000-7000-8000-000000000001',
  storePath:'/Users/me/.codex/sessions/...0001.jsonl', cwd:'/Users/me/Code/x', title:'codex thread',
  updatedAt: 100, kind:'native' }
const subagent: PhysicalSession = { cli:'claude', physicalId:'/p/sub.jsonl', storePath:'/p/sub.jsonl',
  cwd:null, title:null, updatedAt: 90, kind:'subagent', parentId:'cccc1111-1111-4111-8111-111111111111' }
const ledger: LedgerRecord[] = [{ sourcePath:'/Users/me/.claude/projects/enc/cccc1111.jsonl',
  contentSha256:'abc', importedThreadId:'019ea000-0000-7000-8000-000000000002', importedAt: 50 }]

describe('mergeSessions', () => {
  it('collapses a Claude file + its Codex import stub into ONE logical session', () => {
    const merged = mergeSessions([claude, codexStub, codexNative], ledger,
      { '/Users/me/.codex/sessions/...0002.jsonl': claude.storePath })
    expect(merged).toHaveLength(2)
    const dup = merged.find(m => m.copies.length === 2)!
    expect(dup.sessionId).toBe(claude.physicalId)
    expect(dup.contentSourcePath).toBe(claude.storePath)
    expect(dup.resume).toEqual({ cli:'codex', id: codexStub.physicalId })
  })
  it('NEVER surfaces subagents as their own logical session', () => {
    const merged = mergeSessions([claude, subagent], [], {})
    expect(merged).toHaveLength(1)
    expect(merged[0].copies.some(c => c.kind === 'subagent')).toBe(true)
  })
  it('marks deleted when the Claude source file is gone (orphaned stub)', async () => {
    const fs = await import('node:fs')
    ;(fs.existsSync as any).mockImplementation((p: string) => !p.includes('cccc1111'))
    const merged = mergeSessions([codexStub], ledger, {})
    expect(merged[0].deleted).toBe(true)
    expect(merged[0].contentSourcePath).toBe(null)
  })
  it('keeps the source UUID as the logical id for an orphaned stub (so title_override survives)', () => {
    // Claude source file not among scanned natives (deleted/archived/unscanned). The logical id
    // MUST stay the source UUID — title overrides, pins and attach are keyed on it. Falling back to
    // the filesystem path orphans the rename and the session renders as "(未命名)".
    const merged = mergeSessions([codexStub], ledger, {})
    expect(merged).toHaveLength(1)
    expect(merged[0].sessionId).toBe(claude.physicalId)
  })
  it('is order-independent: stub-before-claude yields the same merge as claude-first', () => {
    const map = { '/Users/me/.codex/sessions/...0002.jsonl': claude.storePath }
    const a = mergeSessions([claude, codexStub, codexNative], ledger, map)
    const b = mergeSessions([codexStub, codexNative, claude], ledger, map)
    expect(b).toHaveLength(2)
    const da = a.find(m => m.copies.length === 2)!, db = b.find(m => m.copies.length === 2)!
    expect(db.sessionId).toBe(da.sessionId)
    expect(db.contentSourcePath).toBe(da.contentSourcePath)
    expect(db.resume).toEqual(da.resume)
  })
  it('merges across a non-byte-identical but equivalent source path', () => {
    const nearMiss = '/Users/me/.claude/projects/enc/../enc/cccc1111-1111-4111-8111-111111111111.jsonl' // resolves to claude.storePath
    const stub2 = { ...codexStub, importedFromPath: nearMiss }
    const merged = mergeSessions([claude, stub2], [], {})
    expect(merged).toHaveLength(1)
    expect(merged[0].sessionId).toBe(claude.physicalId)
  })
  it('marks deleted even when the Claude PhysicalSession is present but its file is gone', async () => {
    const fs = await import('node:fs')
    ;(fs.existsSync as any).mockImplementation((p: string) => !p.includes('cccc1111'))
    const merged = mergeSessions([claude, codexStub], ledger, {})
    const dup = merged.find(m => m.copies.length === 2) ?? merged[0]
    expect(dup.deleted).toBe(true)
    expect(dup.contentSourcePath).toBe(null)
    expect(dup.resume).toEqual({ cli: 'codex', id: codexStub.physicalId })
  })
})
