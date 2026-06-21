import { describe, it, expect } from 'vitest'
import {
  meaningfulDocLength, TASK_DOC_MIN_MEANINGFUL,
  assembleTaskSummaryInput, assembleProjectSummaryInput,
} from '../src/data/summary-input'

const EMPTY_TASK_TEMPLATE = [
  '# T — 任务上下文', '',
  '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->', '', '',
  '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->', '', '',
  '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
].join('\n') + '\n'

describe('meaningfulDocLength', () => {
  it('scores a freshly-templated doc near zero', () => {
    expect(meaningfulDocLength(EMPTY_TASK_TEMPLATE)).toBe(0)
    expect(meaningfulDocLength(EMPTY_TASK_TEMPLATE)).toBeLessThan(TASK_DOC_MIN_MEANINGFUL)
  })
  it('counts real prose body but ignores headings and comments', () => {
    const filled = [
      '- [x] 已经实现了完整的导出流水线并通过了全部回归测试用例',
      '- [ ] 还需要补充错误处理与并发场景下的边界测试',
      '- [ ] 与后端约定好接口字段并完成联调验证',
      '- [ ] 整理文档并在发布前完成最终的验收走查',
    ].join('\n') + '\n'
    const doc = EMPTY_TASK_TEMPLATE.replace('## 计划 / TODO\n<!-- 活跃：- [ ] 复选框，完成后勾选 -->\n',
      '## 计划 / TODO\n<!-- 活跃 -->\n' + filled)
    expect(meaningfulDocLength(doc)).toBeGreaterThan(TASK_DOC_MIN_MEANINGFUL)
  })
})

describe('assembleTaskSummaryInput', () => {
  it('returns the doc unchanged when there is no session excerpt', () => {
    expect(assembleTaskSummaryInput('body', '   ', '## 关联会话')).toBe('body')
  })
  it('appends the excerpt under the section label', () => {
    const out = assembleTaskSummaryInput('body', 'transcript text', '## 关联会话')
    expect(out).toContain('body')
    expect(out).toContain('## 关联会话')
    expect(out).toContain('transcript text')
    expect(out.indexOf('body')).toBeLessThan(out.indexOf('## 关联会话'))
  })
})

describe('assembleProjectSummaryInput', () => {
  it('returns the doc unchanged when the project has no tasks', () => {
    expect(assembleProjectSummaryInput('proj', [], '## 任务')).toBe('proj')
  })
  it('renders task status, headline and progress bullets', () => {
    const out = assembleProjectSummaryInput('proj', [
      { title: 'Task A', status: '进行中', summary: { headline: 'A 进展', progress: ['做了 x', '做了 y'], milestones: [] } },
      { title: 'Task B', status: '完成', summary: null },
    ], '## 任务列表')
    expect(out).toContain('## 任务列表')
    expect(out).toContain('- [进行中] Task A — A 进展')
    expect(out).toContain('  - 做了 x')
    expect(out).toContain('  - 做了 y')
    expect(out).toContain('- [完成] Task B')
  })
})
