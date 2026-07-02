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
  it('does not truncate long first-user-message titles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'aaaabbbb-1111-4111-8111-222233334444'
    const title = 'Fix the session title inline editor regression and keep the entire original request visible when editing from the sidebar'
    writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({
      type: 'user',
      message: { role: 'user', content: title },
      cwd: '/tmp',
      timestamp: '2026-06-14T00:29:00.000Z',
    }) + '\n')

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(title.length).toBeGreaterThan(100)
    expect(s.title).toBe(title)
  })
  it('uses assistant text but does not append tool calls to the offline title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'aaaabbbb-1111-4111-8111-222233334445'
    writeFileSync(join(dir, `${id}.jsonl`), [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '标题生成信息太少' },
        cwd: '/tmp',
        timestamp: '2026-06-14T00:29:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我会查看标题生成路径。' },
            { type: 'tool_use', name: 'Bash', input: { command: 'rg -n "extractMeta|generateTitle" src test' } },
          ],
        },
        timestamp: '2026-06-14T00:30:00.000Z',
      }),
    ].join('\n') + '\n')

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(s.title).toBe('标题生成信息太少 / 我会查看标题生成路径。')
  })
  it('uses the native ai-title as the session title', () => {
    // Claude persists the session title (shown in /resume) as an `ai-title` record. Berth used to
    // ignore it and derive from content, which returns null when no first user turn is in the sampled
    // head → the session rendered as "(未命名)" even though Claude has a real title.
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'aaaabbbb-1111-4111-8111-2222aaaabbbb'
    writeFileSync(join(dir, `${id}.jsonl`), [
      JSON.stringify({ type: 'ai-title', aiTitle: '设计项目上下文管理规范AGENTMD', sessionId: id }),
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: id, cwd: '/tmp' }),
    ].join('\n') + '\n')

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(s.title).toBe('设计项目上下文管理规范AGENTMD')
  })

  it('prefers the native ai-title over the derived content title (native > derived)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-claude-'))
    const id = 'aaaabbbb-1111-4111-8111-2222ccccdddd'
    writeFileSync(join(dir, `${id}.jsonl`), [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Claude 的原生标题', sessionId: id }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: '真正的第一条消息' }, cwd: '/tmp', timestamp: '2026-06-14T00:29:00.000Z' }),
    ].join('\n') + '\n')

    const s = listClaudeSessions(dir).find(x => x.kind === 'native')!
    expect(s.title).toBe('Claude 的原生标题')
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
