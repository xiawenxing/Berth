import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastMessageTime } from '../src/adapters/transcript-time'

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-tt-'))
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

describe('lastMessageTime', () => {
  it('returns the epoch-seconds of the last line carrying a timestamp', () => {
    const p = tmpFile('s.jsonl', [
      JSON.stringify({ type: 'user', timestamp: '2026-06-14T00:29:00.000Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-14T00:30:00.000Z' }),
      JSON.stringify({ type: 'permission-mode', permissionMode: 'acceptEdits' }),   // no timestamp
    ].join('\n') + '\n')
    expect(lastMessageTime(p)).toBe(Math.floor(Date.parse('2026-06-14T00:30:00.000Z') / 1000))
  })

  it('returns null when no line carries a timestamp (resume-only control writes)', () => {
    const p = tmpFile('s.jsonl', [
      JSON.stringify({ type: 'ai-title' }),
      JSON.stringify({ type: 'mode' }),
      JSON.stringify({ type: 'permission-mode' }),
    ].join('\n') + '\n')
    expect(lastMessageTime(p)).toBeNull()
  })

  it('returns null for a missing file', () => {
    expect(lastMessageTime('/no/such/file.jsonl')).toBeNull()
  })

  // coco's only on-disk artifact is a single JSON object (session.json) whose freshest signal is the
  // `updated_at` field — there are no per-line `timestamp` records to scan. The live unread refresh
  // must still derive a time from it, or coco's red dot can never light on settle.
  it('falls back to updated_at on a single-object coco session.json', () => {
    const p = tmpFile('session.json', JSON.stringify({
      id: 'c1', created_at: '2026-06-05T13:29:42+08:00', updated_at: '2026-06-10T14:31:28+08:00',
    }))
    expect(lastMessageTime(p)).toBe(Math.floor(Date.parse('2026-06-10T14:31:28+08:00') / 1000))
  })

  it('prefers a per-line timestamp over an updated_at fallback', () => {
    const p = tmpFile('s.jsonl', [
      JSON.stringify({ updated_at: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-14T00:30:00.000Z' }),
    ].join('\n') + '\n')
    expect(lastMessageTime(p)).toBe(Math.floor(Date.parse('2026-06-14T00:30:00.000Z') / 1000))
  })
})
