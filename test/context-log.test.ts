import { describe, it, expect } from 'vitest'
import { rotateLog, type RotateInput, appendLogEntry, lastLogEntries } from '../src/data/context-log'

const HEADING = '## 进展日志'
const POINTER = '> 更早进展见 [归档](progress-archive.md)'
const ARCHIVE_TITLE = '# 进展归档'

function entries(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => `- 2026-06-${String(from + i).padStart(2, '0')}: e${from + i}`)
}
function docWith(logLines: string[]): string {
  return ['# T — 任务上下文', '', '## 目标', 'g', '', HEADING, ...logLines, ''].join('\n')
}
function base(overrides: Partial<RotateInput> = {}): RotateInput {
  return { doc: docWith(entries(3)), archive: '', logHeading: HEADING, pointerLine: POINTER, archiveTitle: ARCHIVE_TITLE, maxLines: 40, keep: 15, ...overrides }
}

describe('rotateLog', () => {
  it('does nothing when entries are under the threshold', () => {
    const r = rotateLog(base({ doc: docWith(entries(40)) }))
    expect(r.rotated).toBe(false)
    expect(r.doc).toBe(docWith(entries(40)))
    expect(r.archive).toBe('')
  })

  it('does nothing exactly at the threshold (> not >=)', () => {
    const r = rotateLog(base({ doc: docWith(entries(40)) }))
    expect(r.rotated).toBe(false)
  })

  it('rotates: keeps the most recent `keep`, archives the rest, adds the pointer', () => {
    const r = rotateLog(base({ doc: docWith(entries(45)), maxLines: 40, keep: 15 }))
    expect(r.rotated).toBe(true)
    expect(r.doc).toContain(POINTER)
    expect(r.doc).toContain('- 2026-06-31: e31')
    expect(r.doc).not.toContain('- 2026-06-30: e30')
    expect(r.archive).toContain(ARCHIVE_TITLE)
    expect(r.archive).toContain('- 2026-06-01: e1')
    expect(r.archive).toContain('- 2026-06-30: e30')
    expect(r.archive).not.toContain('- 2026-06-31: e31')
  })

  it('prepends newly-archived entries above an existing archive body', () => {
    const existing = [ARCHIVE_TITLE, '', '- 2025-12-01: old'].join('\n')
    const r = rotateLog(base({ doc: docWith(entries(45)), archive: existing, keep: 15 }))
    const idxNew = r.archive.indexOf('- 2026-06-01: e1')
    const idxOld = r.archive.indexOf('- 2025-12-01: old')
    expect(idxNew).toBeGreaterThan(-1)
    expect(idxNew).toBeLessThan(idxOld)
    expect(r.archive.match(/# 进展归档/g)!.length).toBe(1)
  })

  it('is a no-op when the heading is absent', () => {
    const doc = '# T\n\n## 目标\ng\n'
    const r = rotateLog(base({ doc }))
    expect(r.rotated).toBe(false)
    expect(r.doc).toBe(doc)
  })

  it('does not re-add the pointer if it is already present', () => {
    const doc = ['# T', '', HEADING, POINTER, '', ...entries(45)].join('\n')
    const r = rotateLog(base({ doc }))
    expect(r.doc.match(/更早进展见/g)!.length).toBe(1)
  })
})

describe('lastLogEntries', () => {
  const doc = ['## 进展日志', '<!-- 追加型 -->', '', '- 2026-06-01: a', '- 2026-06-02: b', '- 2026-06-03: c', ''].join('\n')

  it('returns the last N entries newest-last, parsing date + text', () => {
    const r = lastLogEntries(doc, HEADING, 2)
    expect(r).toEqual([{ date: '2026-06-02', text: 'b' }, { date: '2026-06-03', text: 'c' }])
  })

  it('returns all when fewer than N', () => {
    expect(lastLogEntries(doc, HEADING, 10)).toHaveLength(3)
  })

  it('skips non-bullet lines (comments, pointer) and handles undated bullets', () => {
    const d2 = ['## 进展日志', '> 更早进展见 [归档](progress-archive.md)', '- plain note', ''].join('\n')
    expect(lastLogEntries(d2, HEADING, 5)).toEqual([{ date: null, text: 'plain note' }])
  })

  it('returns [] when the heading is absent', () => {
    expect(lastLogEntries('# T\n## 目标\ng', HEADING, 3)).toEqual([])
  })

  it('returns [] when the section exists but has no entries', () => {
    const empty = ['## 进展日志', '<!-- 追加型 -->', ''].join('\n')
    expect(lastLogEntries(empty, HEADING, 3)).toEqual([])
  })
})

describe('appendLogEntry', () => {
  const tmpl = (log: string[]) =>
    ['# T — 任务上下文', '', '## 计划', '- [ ] x', '', HEADING, '<!-- 追加型 -->', ...log, ''].join('\n')

  it('appends a dated entry to the bottom of the log section', () => {
    const r = appendLogEntry({ doc: tmpl([]), logHeading: HEADING, date: '2026-06-15', text: '完成了 A' })
    expect(r.appended).toBe(true)
    expect(r.doc).toContain('- 2026-06-15: 完成了 A')
    const lines = r.doc.split('\n')
    const h = lines.findIndex(l => l.trim() === HEADING)
    expect(lines.slice(h).some(l => l === '- 2026-06-15: 完成了 A')).toBe(true)
  })

  it('keeps newest at the bottom, below existing entries', () => {
    const r = appendLogEntry({ doc: tmpl(['- 2026-06-01: old']), logHeading: HEADING, date: '2026-06-15', text: 'new' })
    const idxOld = r.doc.indexOf('2026-06-01: old')
    const idxNew = r.doc.indexOf('2026-06-15: new')
    expect(idxOld).toBeGreaterThan(-1)
    expect(idxNew).toBeGreaterThan(idxOld)
  })

  it('does not touch content after the next heading', () => {
    const doc = ['## 进展日志', '<!-- c -->', '', '## 下一节', 'keep me'].join('\n')
    const r = appendLogEntry({ doc, logHeading: HEADING, date: '2026-06-15', text: 't' })
    expect(r.doc).toContain('## 下一节\nkeep me')
    expect(r.doc).toContain('- 2026-06-15: t')
  })

  it('is a no-op when the log heading is absent', () => {
    const doc = '# T\n## 目标\ng\n'
    const r = appendLogEntry({ doc, logHeading: HEADING, date: '2026-06-15', text: 't' })
    expect(r.appended).toBe(false)
    expect(r.doc).toBe(doc)
  })

  it('preserves an existing archive pointer at the section top', () => {
    const r = appendLogEntry({ doc: tmpl([POINTER, '', '- 2026-06-01: a']), logHeading: HEADING, date: '2026-06-15', text: 'b' })
    expect(r.doc).toContain(POINTER)
    const idxPtr = r.doc.indexOf(POINTER)
    const idxNew = r.doc.indexOf('2026-06-15: b')
    expect(idxNew).toBeGreaterThan(idxPtr)
  })

  it('collapses newlines in text into a single log line', () => {
    const r = appendLogEntry({ doc: tmpl([]), logHeading: HEADING, date: '2026-06-15', text: 'line1\n## fake heading\nline2' })
    expect(r.appended).toBe(true)
    // The whole thing must be ONE entry line — no injected heading, no second bullet.
    expect(r.doc).toContain('- 2026-06-15: line1 ## fake heading line2')
    expect(r.doc.split('\n').filter(l => l.startsWith('- 2026-06-15:'))).toHaveLength(1)
    expect(r.doc).not.toMatch(/^## fake heading$/m)
  })
})
