import { describe, it, expect } from 'vitest'
import {
  deriveTitleFromTranscript,
  extractTitleContext,
  extractTitleContextSample,
  extractUserGist,
  extractConversation,
  titleInputFromTranscript,
  replaceImagePathReferences,
  stripNoise,
  isInjectedText,
} from '../src/agent/transcript'

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

describe('extractTitleContext', () => {
  it('samples user requests and assistant replies but ignores claude tool calls', () => {
    const sessionHead = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '帮我看看标题生成' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我会检查标题提取和接口路径。' },
            { type: 'tool_use', name: 'Bash', input: { command: 'rg -n "generateTitle|firstUserTitle" src test' } },
          ],
        },
      }),
    ].join('\n')

    const ctx = extractTitleContext(sessionHead)
    expect(ctx).toContain('USER: 帮我看看标题生成')
    expect(ctx).toContain('ASSISTANT: 我会检查标题提取和接口路径。')
    expect(ctx).not.toContain('TOOL:')
    expect(ctx).not.toContain('rg -n "generateTitle|firstUserTitle"')
  })

  it('ignores codex function calls for title sampling', () => {
    const sessionHead = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Fix title generation' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: { command: 'rg -n "title" src/adapters' } } }),
    ].join('\n')

    const sample = extractTitleContextSample(sessionHead)
    expect(sample.users).toEqual(['Fix title generation'])
    expect(sample.tools).toEqual([])
  })

  it('evenly samples user queries and assistant replies across the session', () => {
    const lines: string[] = []
    for (let i = 1; i <= 15; i++) {
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `Query ${i}` } }))
      if (i <= 5) {
        lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: `Assistant ${i}` } }))
      }
    }

    const sample = extractTitleContextSample(lines.join('\n'))
    expect(sample.users).toHaveLength(12)
    expect(sample.users).toContain('Query 1')
    expect(sample.users).toContain('Query 9')
    expect(sample.users).toContain('Query 15')
    expect(sample.users).not.toContain('Query 3')
    expect(sample.assistants).toEqual(['Assistant 1', 'Assistant 3', 'Assistant 5'])
  })

  it('derives an offline title from the user request without appending tool calls', () => {
    const sessionHead = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Fix title generation' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: { command: 'rg -n "extractTitleContext" src/agent' } } }),
    ].join('\n')

    expect(deriveTitleFromTranscript(sessionHead)).toBe('Fix title generation')
  })

  it('does not append exec_command function calls to ordinary task titles', () => {
    const sessionHead = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ text: '从任务启动的会话后面为什么会带这样的一串数据' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: "sed -n '1,260p' docs/ARCHITECTURE.md",
            workdir: '/Users/bytedance/Documents/Code/berth',
            yield_time_ms: 1000,
            max_output_tokens: 20000,
          }),
        },
      }),
    ].join('\n')

    expect(deriveTitleFromTranscript(sessionHead)).toBe('从任务启动的会话后面为什么会带这样的一串数据')
  })

  it('uses a placeholder instead of pasted local image paths in offline titles', () => {
    const sessionHead = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: '/Users/bytedance/Documents/Obsidian\\ Vault/assets/imagepng-1782446492681-2567.png 1. 打包的 dmg 文件安装失败报错',
      },
    })

    expect(deriveTitleFromTranscript(sessionHead)).toBe('[图片] 1. 打包的 dmg 文件安装失败报错')
  })

  it('does not append process tool JSON to Berth task-launch titles', () => {
    const sessionHead = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: '请开始处理任务：「❓ 移除会话会真的删除本地会话吗？」。' }] } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: {
            cmd: "sed -n '1,240p' /Users/bytedance/.agents/skills/berth-tasks/SKILL.md",
            workdir: '/private/tmp/berth-clean/workspaces/9bc6f94a-c27e-457f-bca6-935e8da139ef',
          },
        },
      }),
    ].join('\n')

    expect(deriveTitleFromTranscript(sessionHead)).toBe('❓ 移除会话会真的删除本地会话吗？')
  })

  it('does not append codex exec_command function calls to image-backed query titles', () => {
    const sessionHead = [
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '[Image #1] 我粘贴的图片在会话标题里会显示成图片地址，不要，跟query一样展示一个[图片]占位就行',
          local_images: ['/Users/bytedance/Documents/Obsidian Vault/assets/imagepng-1782446589701-8336.png'],
          text_elements: [{ placeholder: '[Image #1]' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: "sed -n '1,240p' docs/ARCHITECTURE.md",
            workdir: '/Users/bytedance/Documents/Code/berth',
          }),
        },
      }),
    ].join('\n')

    expect(deriveTitleFromTranscript(sessionHead)).toBe('[Image #1] 我粘贴的图片在会话标题里会显示成图片地址，不要，跟query一样展示一个[图片]占位就行')
  })

  it('derives the task title from Berth task-launch prompts with notes or English locale', () => {
    const zh = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '请开始处理任务：「修复起航标题」。\n\n本次会话补充说明：\n先只查原因' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
    ].join('\n')
    const en = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Please start working on the task: "Fix launch title".' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: { command: 'ls' } } }),
    ].join('\n')

    expect(deriveTitleFromTranscript(zh)).toBe('修复起航标题')
    expect(deriveTitleFromTranscript(en)).toBe('Fix launch title')
  })
})

describe('replaceImagePathReferences', () => {
  it('replaces pasted local image paths with a short placeholder', () => {
    const text = '看看 /Users/bytedance/Documents/Obsidian\\ Vault/assets/imagepng-1782446492681-2567.png 这里'
    expect(replaceImagePathReferences(text)).toBe('看看 [图片] 这里')
  })
})

describe('titleInputFromTranscript', () => {
  it('does not fall back to raw codex metadata', () => {
    const sessionHead = JSON.stringify({
      timestamp: '2026-06-16T00:00:00Z',
      type: 'session_meta',
      payload: {
        id: '019ea000-0000-7000-8000-000000000001',
        cwd: '/Users/me/Code/berth',
        originator: 'codex-tui',
      },
    })

    expect(titleInputFromTranscript(sessionHead)).toBe('')
  })

  it('keeps plain text input for live agent tests and manual callers', () => {
    expect(titleInputFromTranscript('user: Fix title generation')).toBe('user: Fix title generation')
  })
})

describe('extractConversation', () => {
  const claude = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '帮我实现导出功能' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: '让我先想想架构' },
      { type: 'text', text: '好的，我先看一下相关代码' },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls src' } },
    ] } }),
    // tool_result comes back as a user-role message — must be dropped (no top-level .text)
    JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file1\nfile2' }] },
    ] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'text', text: '已经实现并通过测试' },
    ] } }),
  ].join('\n')

  it('keeps user queries and agent text, drops thinking / tool calls / tool results', () => {
    const out = extractConversation(claude)
    expect(out).toContain('USER: 帮我实现导出功能')
    expect(out).toContain('ASSISTANT: 好的，我先看一下相关代码')
    expect(out).toContain('ASSISTANT: 已经实现并通过测试')
    expect(out).not.toContain('让我先想想架构')   // thinking
    expect(out).not.toContain('ls src')           // tool_use input
    expect(out).not.toContain('file1')            // tool_result artifact
  })

  it('handles codex response_item messages and skips the env preamble + function_call', () => {
    const codex = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# environment_context\nstuff' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修一下这个 bug' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"git status"}' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: ['想一想'] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已修复' }] } }),
    ].join('\n')
    const out = extractConversation(codex)
    expect(out).toContain('USER: 修一下这个 bug')
    expect(out).toContain('ASSISTANT: 已修复')
    expect(out).not.toContain('environment_context')
    expect(out).not.toContain('git status')
    expect(out).not.toContain('想一想')
  })

  it('respects the char budget', () => {
    const out = extractConversation(claude, 20)
    expect(out.length).toBeLessThanOrEqual(20)
  })
})
