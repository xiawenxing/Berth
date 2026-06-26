import { describe, it, expect } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { prettyToolName, splitProcessAndAnswer, toolCallSummary } from './ChatTranscript'
import { ChatTranscript } from './ChatTranscript'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('prettyToolName', () => {
  it('maps codex snake_case item types to friendly labels', () => {
    expect(prettyToolName('command_execution')).toBe('命令执行')
    expect(prettyToolName('web_search')).toBe('网页搜索')
    expect(prettyToolName('file_change')).toBe('文件改动')
  })
  it('passes through claude tool names unchanged', () => {
    expect(prettyToolName('Bash')).toBe('Bash')
    expect(prettyToolName('Read')).toBe('Read')
  })
})

describe('toolCallSummary', () => {
  it('summarizes tool calls as muted inline text content', () => {
    expect(toolCallSummary({ kind: 'tool_call', id: '1', name: 'command_execution', status: 'done', input: { command: 'npm test' } }))
      .toBe('命令执行 · npm test')
    expect(toolCallSummary({ kind: 'tool_call', id: '2', name: 'Read', status: 'running', input: { file_path: 'web/src/App.tsx' } }))
      .toBe('Read · web/src/App.tsx · 运行中')
  })
})

describe('splitProcessAndAnswer', () => {
  it('folds everything before the trailing text run as process', () => {
    const blocks = [
      { kind: 'tool_call' as const, id: '1', name: 'Read', status: 'done' as const, input: { file_path: 'a.ts' } },
      { kind: 'text' as const, text: '中间说明' },
      { kind: 'tool_call' as const, id: '2', name: 'Bash', status: 'done' as const, input: { command: 'npm test' } },
      { kind: 'text' as const, text: '最终回答' },
    ]
    expect(splitProcessAndAnswer(blocks)).toEqual({
      process: blocks.slice(0, 3),
      answer: blocks.slice(3),
    })
  })
})

describe('ChatTranscript states', () => {
  it('shows a loading state before the empty state while history is loading', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = () => {}

    try {
      await act(async () => {
        root.render(createElement(ChatTranscript, { turns: [], loading: true }))
      })
      expect(host.textContent).toContain('正在加载会话历史')
      expect(host.textContent).not.toContain('还没有对话')
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })
})
