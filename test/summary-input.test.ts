import { describe, it, expect } from 'vitest'
import { assembleTaskSummaryInput, assembleProjectSummaryInput } from '../src/data/summary-input'

describe('assembleTaskSummaryInput', () => {
  it('returns the doc unchanged when there is no session digest', () => {
    expect(assembleTaskSummaryInput('body', '   ', '## 关联会话')).toBe('body')
  })
  it('appends the digest under the section label', () => {
    const out = assembleTaskSummaryInput('body', 'USER: hi\nASSISTANT: hello', '## 关联会话')
    expect(out).toContain('body')
    expect(out).toContain('## 关联会话')
    expect(out).toContain('USER: hi')
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
