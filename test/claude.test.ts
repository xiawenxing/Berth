import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listClaudeSessions } from '../src/adapters/claude'
const ROOT = new URL('./fixtures/claude/projects/', import.meta.url).pathname

describe('claude adapter', () => {
  it('lists ONLY top-level <uuid>.jsonl as sessions', () => {
    const s = listClaudeSessions(ROOT)
    const native = s.filter(x => x.kind === 'native')
    expect(native).toHaveLength(1)
    expect(native[0].physicalId).toBe('cccc1111-1111-4111-8111-111111111111')
  })
  it('reads real cwd and title from jsonl content', () => {
    const native = listClaudeSessions(ROOT).find(x => x.kind === 'native')!
    expect(native.cwd).toBe('/Users/me/Code/y')
    expect(native.title).toBe('hi')
  })
  it('classifies subagent transcripts as kind=subagent with parentId', () => {
    const sub = listClaudeSessions(ROOT).find(x => x.kind === 'subagent')!
    expect(sub.parentId).toBe('cccc1111-1111-4111-8111-111111111111')
  })

  it('derives updatedAt from the last real MESSAGE, not a resume-only control write (permission-mode)', () => {
    // Repro: opening a session appends a `permission-mode` line (no timestamp), bumping the file
    // mtime. updatedAt must reflect the last real message, not that bookkeeping write — otherwise a
    // session you already read pops back to "unread" every time Berth resumes it.
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'aaaabbbb-1111-4111-8111-222233334444'
    const lastMsgIso = '2026-06-14T00:30:00.000Z'
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' }, cwd: '/tmp', timestamp: '2026-06-14T00:29:00.000Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' }, timestamp: lastMsgIso }),
      JSON.stringify({ type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: id }),   // resume bookkeeping, no timestamp
    ]
    const path = join(dir, `${id}.jsonl`)
    writeFileSync(path, lines.join('\n') + '\n')
    // Simulate the mtime bump from the resume write: 10 minutes AFTER the last real message.
    const mtimeSec = Math.floor(Date.parse(lastMsgIso) / 1000) + 600
    utimesSync(path, mtimeSec, mtimeSec)

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(s.updatedAt).toBe(Math.floor(Date.parse(lastMsgIso) / 1000))   // last message, NOT mtime
  })

  it('falls back to file mtime when no line carries a timestamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'ccccdddd-2222-4222-8222-333344445555'
    const path = join(dir, `${id}.jsonl`)
    writeFileSync(path, JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: id }) + '\n')
    const mtimeSec = 1781369000
    utimesSync(path, mtimeSec, mtimeSec)

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(s.updatedAt).toBe(mtimeSec)
  })
})
