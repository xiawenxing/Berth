import { describe, it, expect } from 'vitest'
import { prettyToolName } from './ChatTranscript'

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
