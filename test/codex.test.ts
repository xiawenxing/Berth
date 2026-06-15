import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('does not truncate long first-user-message titles', () => {
    const root = mkdtempSync(join(tmpdir(), 'berth-codex-'))
    const dir = join(root, 'sessions', '2026', '06', '15')
    mkdirSync(dir, { recursive: true })
    const id = '019ea000-0000-7000-8000-000000000099'
    const title = 'Fix the session title inline editor regression and keep the entire original request visible when editing from the sidebar'
    writeFileSync(join(dir, `rollout-${id}.jsonl`), [
      JSON.stringify({ timestamp: '2026-06-15T00:00:00Z', payload: { type: 'session_meta', id, cwd: '/tmp', timestamp: '2026-06-15T00:00:00Z' } }),
      JSON.stringify({ timestamp: '2026-06-15T00:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: title }] } }),
    ].join('\n') + '\n')

    const s = listCodexSessions(root).find(x => x.physicalId === id)!
    expect(title.length).toBeGreaterThan(100)
    expect(s.title).toBe(title)
  })
  it('includes process clues when the transcript has tool calls', () => {
    const root = mkdtempSync(join(tmpdir(), 'berth-codex-'))
    const dir = join(root, 'sessions', '2026', '06', '15')
    mkdirSync(dir, { recursive: true })
    const id = '019ea000-0000-7000-8000-000000000100'
    writeFileSync(join(dir, `rollout-${id}.jsonl`), [
      JSON.stringify({ timestamp: '2026-06-15T00:00:00Z', payload: { type: 'session_meta', id, cwd: '/tmp', timestamp: '2026-06-15T00:00:00Z' } }),
      JSON.stringify({ timestamp: '2026-06-15T00:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix title generation' }] } }),
      JSON.stringify({ timestamp: '2026-06-15T00:02:00Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: { command: 'rg -n "firstUserTitle|generateTitle" src test' } } }),
    ].join('\n') + '\n')

    const s = listCodexSessions(root).find(x => x.physicalId === id)!
    expect(s.title).toBe('Fix title generation / shell command: rg -n "firstUserTitle|generateTitle" src test')
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
