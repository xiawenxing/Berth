import { describe, it, expect } from 'vitest'
import { lineDiff } from './fileEdits'

describe('lineDiff', () => {
  it('counts pure additions (empty before)', () => {
    const d = lineDiff('', 'a\nb\nc')
    expect(d.added).toBe(3)
    expect(d.removed).toBe(0)
    expect(d.hunks).toEqual([
      { op: '+', text: 'a' },
      { op: '+', text: 'b' },
      { op: '+', text: 'c' },
    ])
    expect(d.truncated).toBe(false)
  })

  it('counts pure removals (empty after)', () => {
    const d = lineDiff('a\nb', '')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(2)
  })

  it('counts a mixed edit, keeping context lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.hunks).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
      { op: ' ', text: 'c' },
    ])
  })

  it('reports 0/0 for identical text', () => {
    const d = lineDiff('x\ny', 'x\ny')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
  })

  it('caps hunks and sets truncated', () => {
    const before = ''
    const after = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const d = lineDiff(before, after)
    expect(d.added).toBe(500)
    expect(d.hunks.length).toBe(400)
    expect(d.truncated).toBe(true)
  })
})
