import { describe, it, expect } from 'vitest'
import { applyConsolidation } from '../src/data/context-apply'

const LOG = '## 进展日志'
const STATUS = '## 当前状态'
function doc(parts: string[]) { return parts.join('\n') }

describe('applyConsolidation', () => {
  it('appends a progress line to the end of the log section', () => {
    const d = doc(['# P — 项目上下文', '', STATUS, '旧状态', '', LOG, '- 2026-06-01: a', ''])
    const out = applyConsolidation(d, { progress: '2026-06-15: b', status: '' }, { logHeading: LOG, statusHeading: STATUS })
    const lines = out.split('\n')
    const li = lines.indexOf(LOG)
    expect(out).toContain('- 2026-06-15: b')
    expect(lines.indexOf('- 2026-06-15: b')).toBeGreaterThan(lines.indexOf('- 2026-06-01: a'))
    expect(lines.indexOf('- 2026-06-15: b')).toBeGreaterThan(li)
  })

  it('overwrites the status section body, preserving heading + comment', () => {
    const d = doc(['# P', '', STATUS, '<!-- 活跃 -->', '旧状态一', '旧状态二', '', LOG, '- x', ''])
    const out = applyConsolidation(d, { progress: '', status: '新状态' }, { logHeading: LOG, statusHeading: STATUS })
    expect(out).toContain('<!-- 活跃 -->')
    expect(out).toContain('新状态')
    expect(out).not.toContain('旧状态一')
    expect(out).not.toContain('旧状态二')
    expect(out).toContain('- x')
  })

  it('does nothing when both progress and status are empty', () => {
    const d = doc(['# P', '', STATUS, 's', '', LOG, '- x', ''])
    expect(applyConsolidation(d, { progress: '', status: '' }, { logHeading: LOG, statusHeading: STATUS })).toBe(d)
  })

  it('skips status overwrite when the status heading is absent (no new section)', () => {
    const d = doc(['# P', '', LOG, '- x', ''])
    const out = applyConsolidation(d, { progress: 'p', status: 'whatever' }, { logHeading: LOG, statusHeading: STATUS })
    expect(out).not.toContain(STATUS)
    expect(out).toContain('- p')
  })

  it('does not touch stable sections', () => {
    const d = doc(['# P', '', '## 目标 / 为什么', '稳定目标', '', STATUS, '老', '', LOG, '- x', ''])
    const out = applyConsolidation(d, { progress: 'np', status: '新' }, { logHeading: LOG, statusHeading: STATUS })
    expect(out).toContain('稳定目标')
  })
})
