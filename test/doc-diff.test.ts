// test/doc-diff.test.ts
import { describe, it, expect } from 'vitest'
import { splitSections, diffSections } from '../src/data/doc-diff'

const A = ['# T', '', '## 目标', 'old goal', '', '## 进展日志', '- 2026-06-15: a', ''].join('\n')

describe('doc-diff', () => {
  it('splits by heading into trimmed bodies', () => {
    const m = splitSections(A)
    expect([...m.keys()]).toEqual(['T', '目标', '进展日志'])
    expect(m.get('目标')).toBe('old goal')
  })

  it('reports changed / added / removed sections', () => {
    const B = ['# T', '', '## 目标', 'NEW goal', '', '## 关键资料', 'x', '', '## 进展日志', '- 2026-06-15: a', ''].join('\n')
    const d = diffSections(A, B)
    expect(d.changed).toEqual(['目标'])
    expect(d.added).toEqual(['关键资料'])
    expect(d.removed).toEqual([])
  })

  it('no diff when bodies are identical', () => {
    expect(diffSections(A, A)).toEqual({ changed: [], added: [], removed: [] })
  })
})
