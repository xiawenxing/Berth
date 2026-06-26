import { describe, expect, it } from 'vitest'
import { summarizeCompactedContext } from '../src/agent/context-compact'

describe('agent/context-compact', () => {
  it('returns the markdown document produced by the summarizer agent', async () => {
    const out = await summarizeCompactedContext({
      doc: '# T\n\n## 当前状态\nx',
      fallbackDoc: '# T\n\n## 参考子文档\n- 2026-06-24: [上下文参考](references/context-2026-06-24.md)\n',
      referenceRel: 'references/context-2026-06-24.md',
      date: '2026-06-24',
      locale: 'zh-CN',
      maxChars: 24000,
      keepChars: 12000,
      logHeading: '## 进展日志',
      logKeep: 15,
    }, { cli: 'claude' }, async () => [
      '```markdown',
      '# T',
      '',
      '## 参考子文档',
      '- 2026-06-24: [上下文参考](references/context-2026-06-24.md)',
      '```',
    ].join('\n'))

    expect(out).toContain('# T')
    expect(out).toContain('references/context-2026-06-24.md')
    expect(out).not.toContain('```')
  })
})

