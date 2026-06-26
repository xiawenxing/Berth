import { describe, it, expect } from 'vitest'
import { codexTurnArgv, cocoTurnArgv } from '../src/pty/launch'

describe('codexTurnArgv', () => {
  it('fresh turn (resumeId null): exec + --json + bypass flags + prompt last, NO resume', () => {
    const a = codexTurnArgv('do it', null)
    expect(a[0]).toBe('exec')
    expect(a).not.toContain('resume')
    expect(a).toContain('--json')
    expect(a).toContain('--skip-git-repo-check')
    expect(a).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(a[a.length - 1]).toBe('do it')
  })
  it('resume turn: exec resume <id> ... prompt (id right after resume, no -C)', () => {
    const a = codexTurnArgv('again', 'tid-9', { model: 'gpt-5' })
    expect(a.slice(0, 3)).toEqual(['exec', 'resume', 'tid-9'])
    expect(a).not.toContain('-C')
    expect(a.join(' ')).toContain('--model gpt-5')
    expect(a[a.length - 1]).toBe('again')
  })
})

describe('cocoTurnArgv', () => {
  it('fresh turn: pre-minted --session-id + stream-json print flags + prompt', () => {
    const a = cocoTurnArgv('hi', null, 'sess-abc')
    expect(a.join(' ')).toContain('--session-id sess-abc')
    expect(a).toContain('--print')
    expect(a).toContain('--output-format=stream-json')
    expect(a).toContain('-y')
    expect(a[a.length - 1]).toBe('hi')
  })
  it('resume turn: --resume=<id> (= form), no --session-id', () => {
    const a = cocoTurnArgv('more', 'sess-abc', 'sess-abc')
    expect(a).toContain('--resume=sess-abc')
    expect(a).not.toContain('--session-id')
    expect(a[a.length - 1]).toBe('more')
  })
})
