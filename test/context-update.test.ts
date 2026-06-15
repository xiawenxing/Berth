// test/context-update.test.ts
import { describe, it, expect } from 'vitest'
import { extractMarkdownDoc, updateContext, stripCodeFence } from '../src/agent/context-update'

const DOC = ['# T — 任务上下文', '', '## 目标 / 验收标准', 'old', '', '## 进展日志', '- 2026-06-15: a', ''].join('\n')
const agent = { cli: 'claude' as const }

describe('stripCodeFence', () => {
  it('unwraps a fenced reply', () => {
    expect(stripCodeFence('```markdown\n# X\n```')).toBe('# X')
    expect(stripCodeFence('# X')).toBe('# X')
  })

  it('extracts a markdown doc after a short preamble', () => {
    expect(extractMarkdownDoc('现在我有足够的信息。\n\n# X\n\n## A\nbody')).toBe('# X\n\n## A\nbody')
  })
})

describe('updateContext', () => {
  it('returns the new doc + section diff when the agent rewrites a section', async () => {
    const newDoc = DOC.replace('old', 'NEW GOAL')
    const r = await updateContext(
      { kind: 'task', contextDoc: DOC, userInput: '目标改了', date: '2026-06-16', locale: 'zh-CN', agent },
      async () => '```\n' + newDoc + '\n```',
    )
    expect(r.newDoc).toContain('NEW GOAL')
    expect(r.diff.changed).toContain('目标 / 验收标准')
  })

  it('accepts a full markdown doc even when the agent prepends commentary', async () => {
    const newDoc = DOC.replace('old', 'NEW GOAL')
    const r = await updateContext(
      { kind: 'task', contextDoc: DOC, userInput: '目标改了', date: '2026-06-16', locale: 'zh-CN', agent },
      async () => '现在我有足够的信息来更新上下文文件。\n\n' + newDoc,
    )
    expect(r.newDoc).toContain('NEW GOAL')
    expect(r.newDoc.startsWith('# T')).toBe(true)
    expect(r.diff.changed).toContain('目标 / 验收标准')
  })

  it('guards against truncation / no-op replies', async () => {
    const tiny = await updateContext({ kind: 'task', contextDoc: DOC, userInput: 'x', date: '2026-06-16', locale: 'zh-CN', agent }, async () => 'oops')
    expect(tiny.newDoc).toBe('')
    const same = await updateContext({ kind: 'task', contextDoc: DOC, userInput: 'x', date: '2026-06-16', locale: 'zh-CN', agent }, async () => DOC)
    expect(same.newDoc).toBe('')                  // identical → nothing to write
  })

  it('swallows agent errors into an empty result', async () => {
    const r = await updateContext({ kind: 'task', contextDoc: DOC, userInput: 'x', date: '2026-06-16', locale: 'zh-CN', agent }, async () => { throw new Error('boom') })
    expect(r.newDoc).toBe('')
  })
})
