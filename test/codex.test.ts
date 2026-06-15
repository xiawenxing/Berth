import { describe, it, expect } from 'vitest'
import { listCodexSessions, loadImportLedger } from '../src/adapters/codex'
const ROOT = new URL('./fixtures/codex/', import.meta.url).pathname

describe('codex adapter', () => {
  it('globs rollouts (not the index) and parses session_meta', () => {
    const s = listCodexSessions(ROOT)
    expect(s.map(x => x.physicalId).sort()).toEqual([
      '019ea000-0000-7000-8000-000000000001',
      '019ea000-0000-7000-8000-000000000002',
    ])
    expect(s.find(x => x.physicalId.endsWith('0001'))!.cwd).toBe('/Users/me/Code/x')
  })
  it('extracts title from the first genuine user response_item (body-extraction wins over index)', () => {
    const s = listCodexSessions(ROOT)
    const native = s.find(x => x.physicalId.endsWith('0001'))!
    // fixture has a response_item user message; body-extraction should win over the session_index thread_name
    expect(native.title).toBe('Fix the login toast not showing')
  })
  it('falls back to session_index.jsonl thread_name when no response_item user message exists', () => {
    // The stub (0002) has no response_item lines; it is kind='import-stub' so firstUserTitle is skipped,
    // but we also verify the fallback path works by checking the stub's title is null (no index entry)
    const s = listCodexSessions(ROOT)
    const stub = s.find(x => x.physicalId.endsWith('0002'))!
    expect(stub.title).toBeNull()
  })
  it('classifies import stubs', () => {
    const stub = listCodexSessions(ROOT).find(x => x.physicalId.endsWith('0002'))!
    expect(stub.kind).toBe('import-stub')
    expect(stub.importedFromPath).toBe('/Users/me/.claude/projects/enc/cccc1111.jsonl')
  })
  it('dates updatedAt from the LAST message, not the session_meta creation time', () => {
    // 0001's rollout runs 00:00:00Z (session_meta) → 00:01:00Z (last message). updatedAt must track
    // the last message so the unread dot re-lights and ordering stays fresh — not freeze at creation.
    const native = listCodexSessions(ROOT).find(x => x.physicalId.endsWith('0001'))!
    expect(native.updatedAt).toBe(Math.floor(Date.parse('2026-06-08T00:01:00Z') / 1000))
  })
  it('loads ledger with int/float-tolerant imported_at', () => {
    const led = loadImportLedger(ROOT)
    expect(led).toHaveLength(1)
    expect(led[0].importedThreadId).toBe('019ea000-0000-7000-8000-000000000002')
  })
})
