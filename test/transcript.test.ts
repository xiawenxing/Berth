import { describe, it, expect } from 'vitest'
import { extractUserGist, stripNoise, isInjectedText } from '../src/agent/transcript'

describe('stripNoise', () => {
  it('removes system-reminder blocks', () => {
    const input = 'before<system-reminder>secret stuff here</system-reminder>after'
    expect(stripNoise(input)).toBe('beforeafter')
  })

  it('removes persisted-output blocks', () => {
    const input = 'before<persisted-output>some output</persisted-output>after'
    expect(stripNoise(input)).toBe('beforeafter')
  })

  it('removes slash-command wrappers', () => {
    const input = '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args></command-args>'
    expect(stripNoise(input)).toBe('')
  })

  it('removes local-command wrappers', () => {
    const input = '<local-command-caveat>Caveat: do not respond</local-command-caveat>\n<local-command-stdout>done</local-command-stdout>'
    expect(stripNoise(input)).toBe('')
  })
})

describe('isInjectedText', () => {
  it('returns true for empty string', () => {
    expect(isInjectedText('')).toBe(true)
  })

  it('returns true for text starting with <', () => {
    expect(isInjectedText('<command-name>/foo</command-name>')).toBe(true)
  })

  it('returns true for text containing Conduit marker', () => {
    expect(isInjectedText('You are B for Conduit session 20260611')).toBe(true)
  })

  it('returns true for text containing B-role marker', () => {
    expect(isInjectedText('# Conduit B-role active')).toBe(true)
  })

  it('returns true for text containing superpowers marker', () => {
    expect(isInjectedText('superpowers skill content here')).toBe(true)
  })

  it('returns false for real user message', () => {
    expect(isInjectedText('帮我修复登录页')).toBe(false)
  })
})

describe('extractUserGist — claude format', () => {
  it('skips Conduit-injected attachment lines and returns real user message', () => {
    // Simulates a session head where:
    //   - lines 0-4: non-user entries and hook attachments with Conduit content
    //   - line 5: user message with a <system-reminder>Conduit B-role...</system-reminder> block
    //   - line 6: real user message
    const sessionHead = [
      JSON.stringify({ type: 'last-prompt', sessionId: 'abc' }),
      JSON.stringify({ type: 'mode', mode: 'normal' }),
      JSON.stringify({
        type: 'attachment',
        attachment: {
          type: 'hook_success',
          stdout: JSON.stringify({
            hookSpecificOutput: {
              additionalContext: '# Conduit B-role active\nYou are B for Conduit session 20260611.',
            },
          }),
        },
      }),
      // A user message that is entirely a system-reminder with Conduit B-role content (polluted)
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '<system-reminder># Conduit B-role active\nYou are B for Conduit session `20260611-121225`.\n- Truth file: /some/path/session.md\n</system-reminder>',
        },
      }),
      // A user message that is a slash-command wrapper (injected)
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args></command-args>',
        },
      }),
      // The REAL first user message
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '帮我修复登录页',
        },
      }),
    ].join('\n')

    const gist = extractUserGist(sessionHead)

    // Must contain the real user message
    expect(gist).toContain('帮我修复登录页')
    // Must NOT contain Conduit
    expect(gist).not.toContain('Conduit')
    expect(gist).not.toContain('B-role')
  })

  it('extracts multiple genuine user messages (up to 3)', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first message' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'second message' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'third message' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'fourth message' } }),
    ].join('\n')

    const gist = extractUserGist(lines)
    expect(gist).toContain('first message')
    expect(gist).toContain('second message')
    expect(gist).toContain('third message')
    // Should stop at 3
    expect(gist).not.toContain('fourth message')
  })

  it('handles list-type content (image + text)', () => {
    const sessionHead = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '帮我创建一个项目领域' },
          { type: 'image', source: { type: 'base64', data: 'abc123' } },
        ],
      },
    })

    const gist = extractUserGist(sessionHead)
    expect(gist).toContain('帮我创建一个项目领域')
  })

  it('returns fallback stripped content when no genuine messages found', () => {
    // All messages are injected/system
    const sessionHead = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '<system-reminder>Conduit B-role active</system-reminder>',
        },
      }),
    ].join('\n')

    const gist = extractUserGist(sessionHead)
    // Fallback: stripped raw head — should NOT contain Conduit since it's inside system-reminder
    expect(gist).not.toContain('Conduit')
  })
})

describe('extractUserGist — codex format', () => {
  it('skips injected user items and returns real user message', () => {
    const sessionHead = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>some context</environment_context>' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Fix the login bug' }],
        },
      }),
    ].join('\n')

    const gist = extractUserGist(sessionHead)
    expect(gist).toContain('Fix the login bug')
    expect(gist).not.toContain('environment_context')
  })
})
