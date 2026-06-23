import { describe, it, expect } from 'vitest'
import { freshArgvStream, resumeArgvStream } from '../src/pty/launch'

describe('freshArgvStream (Model B claude)', () => {
  it('emits the stream-json flag set with a pre-minted --session-id and NO positional prompt', () => {
    const argv = freshArgvStream('claude', { cwd: '/x', sessionId: 'uuid-1', initialPrompt: 'hello' })
    expect(argv).toContain('-p')
    expect(argv).toContain('--input-format')
    expect(argv).toContain('--output-format')
    // stream-json on both sides
    expect(argv.filter((a) => a === 'stream-json')).toHaveLength(2)
    expect(argv).toContain('--verbose')
    expect(argv).toContain('--include-partial-messages')
    expect(argv).toContain('--dangerously-skip-permissions')
    expect(argv.join(' ')).toContain('--session-id uuid-1')
    // the user's first message is sent via stdin, never as a positional prompt
    expect(argv).not.toContain('--')
    expect(argv).not.toContain('hello')
  })

  it('passes through model, inject file, and add-dirs', () => {
    const argv = freshArgvStream('claude', { cwd: '/x', model: 'opus', injectFile: '/i', addDirs: ['/a', '/b'] })
    expect(argv.join(' ')).toContain('--model opus')
    expect(argv.join(' ')).toContain('--append-system-prompt-file /i')
    expect(argv.filter((a) => a === '--add-dir')).toHaveLength(2)
  })

  it('is claude-only for now (throws for other CLIs)', () => {
    expect(() => freshArgvStream('codex' as any, { cwd: '/x' })).toThrow()
    expect(() => freshArgvStream('coco' as any, { cwd: '/x' })).toThrow()
  })
})

describe('resumeArgvStream (Model B claude)', () => {
  it('resumes with --resume and NEVER passes --session-id (they conflict)', () => {
    const argv = resumeArgvStream('claude', 'sess-9')
    expect(argv.join(' ')).toContain('--resume sess-9')
    expect(argv).not.toContain('--session-id')
    expect(argv).toContain('--input-format')
    expect(argv.filter((a) => a === 'stream-json')).toHaveLength(2)
  })
})
