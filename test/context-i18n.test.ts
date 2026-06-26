import { describe, it, expect } from 'vitest'
import { contextStrings } from '../src/i18n'

describe('contextStrings', () => {
  it('zh-CN: rules, headings, and templates are present and consistent', () => {
    const c = contextStrings('zh-CN')
    expect(c.compactRules.length).toBeGreaterThanOrEqual(4)
    expect(c.logHeading).toBe('## 进展日志')
    expect(c.taskTemplate('登录页', 'Berth')).toContain(c.logHeading)
    expect(c.taskTemplate('登录页', 'Berth')).toContain('登录页')
    expect(c.projectTemplate('Berth')).toContain(c.logHeading)
    expect(c.projectTemplate('Berth')).toContain('Berth')
    expect(c.protocolDoc).toContain('进展日志')
    expect(c.archivePointer).toContain('归档')
  })

  it('en: no zh-CN leakage in injected rules/templates', () => {
    const c = contextStrings('en')
    expect(c.logHeading).toBe('## Progress log')
    expect(c.taskTemplate('Login', 'Berth')).toContain('## Progress log')
    expect(c.taskTemplate('Login', 'Berth')).not.toContain('进展')
    expect(c.compactRules.join(' ')).not.toContain('上下文')
  })

  it('exposes consolidation prompt + status headings per kind', () => {
    const zh = contextStrings('zh-CN')
    expect(zh.statusHeadingProject).toBe('## 当前状态')
    expect(zh.statusHeadingTask).toBe('## 计划 / TODO')
    const p = zh.consolidatePrompt('project', 'CTX', 'TRANS')
    expect(p).toContain('CTX'); expect(p).toContain('TRANS')
    expect(p).toMatch(/JSON/i)
    const en = contextStrings('en')
    expect(en.statusHeadingProject).toBe('## Current status')
    expect(en.consolidatePrompt('task', 'C', 'T')).toMatch(/JSON/i)
  })

  it('status headings actually appear in the templates (guards the silent no-op overwrite)', () => {
    // applyConsolidation overwrites the section whose heading === statusHeading*. If a template heading
    // ever drifts from these constants, the overwrite silently no-ops — so assert containment here.
    for (const loc of ['zh-CN', 'en'] as const) {
      const c = contextStrings(loc)
      expect(c.taskTemplate('t', 'p')).toContain(c.statusHeadingTask)
      expect(c.projectTemplate('p')).toContain(c.statusHeadingProject)
    }
  })
})

describe('structured summary prompts', () => {
  it('projectSummaryPrompt / taskSummaryDetailPrompt exist for both locales and request strict JSON', () => {
    for (const key of ['projectSummaryPrompt', 'taskSummaryDetailPrompt'] as const) {
      const zh = contextStrings('zh-CN')[key]
      const en = contextStrings('en')[key]
      // non-empty + genuinely localized (not a shared/placeholder string)
      expect(zh.length).toBeGreaterThan(20)
      expect(en.length).toBeGreaterThan(20)
      expect(zh).not.toBe(en)
      // both must spell out the JSON shape the parser expects
      for (const p of [zh, en]) {
        expect(p).toContain('headline')
        expect(p).toContain('progress')
        expect(p).toContain('milestones')
      }
      expect(zh).toMatch(/忽略|稳定/)
      expect(en.toLowerCase()).toMatch(/ignore|stable/)
    }
  })
})
