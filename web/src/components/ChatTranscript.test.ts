import { describe, it, expect } from 'vitest'
import { prettyToolName, splitProcessAndAnswer, toolCallSummary } from './ChatTranscript'

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
