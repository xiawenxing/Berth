import { describe, it, expect } from 'vitest'
import { runAgent, generateTitle, parseStructuredSummary } from '../src/agent/index'
import { buildManifest } from '../src/agent/manifest'

describe('agent module', () => {
  it('exports runAgent and generateTitle as functions', () => {
    expect(typeof runAgent).toBe('function')
    expect(typeof generateTitle).toBe('function')
  })
})

describe('parseStructuredSummary', () => {
  it('parses a well-formed JSON object', () => {
    const r = parseStructuredSummary('{"headline":"在重构会话列表","progress":["a","b"],"milestones":[{"text":"m1","done":true},{"text":"m2","done":false}]}')
    expect(r.headline).toBe('在重构会话列表')
    expect(r.progress).toEqual(['a', 'b'])
    expect(r.milestones).toEqual([{ text: 'm1', done: true }, { text: 'm2', done: false }])
  })

  it('extracts JSON wrapped in code fences and prose', () => {
    const raw = 'Sure! Here is the summary:\n```json\n{"headline":"h","progress":["x"],"milestones":[]}\n```\nHope that helps.'
    const r = parseStructuredSummary(raw)
    expect(r.headline).toBe('h')
    expect(r.progress).toEqual(['x'])
    expect(r.milestones).toEqual([])
  })

  it('coerces missing/invalid fields and drops empty entries', () => {
    const r = parseStructuredSummary('{"headline":"h","progress":["ok","  ",null],"milestones":[{"text":"keep"},{"done":true}]}')
    expect(r.progress).toEqual(['ok'])
    expect(r.milestones).toEqual([{ text: 'keep', done: false }])
  })

  it('falls back to a headline-only summary when not JSON', () => {
    const r = parseStructuredSummary('just a plain sentence with no json')
    expect(r.headline).toBe('just a plain sentence with no json')
    expect(r.progress).toEqual([])
    expect(r.milestones).toEqual([])
  })
})

describe('manifest finish-protocol', () => {
  const base = {
    kind: 'task' as const, projectName: 'P', docsRoot: '/tmp/docs',
    todo: { id: 'task-xyz', title: 'T', status: '进行中', priority: 'P1', detailDoc: null, projectId: null } as any,
    statuses: ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消'],
  }
  it('includes the task id, the sentinel line spec, and an id-filled command', () => {
    const { text } = buildManifest(base)
    expect(text).toContain('task-xyz')
    expect(text).toContain('BERTH_TASK_STATUS: task-xyz')
    expect(text).toContain('berth task done task-xyz')
  })
  it('omits the finish-protocol for a project launch', () => {
    const { text } = buildManifest({
      kind: 'project', projectName: 'P', docsRoot: '/tmp/docs', projectTodos: [],
    } as any)
    expect(text).not.toContain('BERTH_TASK_STATUS')
  })
})

describe.skipIf(!process.env.BERTH_LIVE)('agent live (BERTH_LIVE)', () => {
  it('generateTitle returns a non-empty string <= 100 chars', async () => {
    const title = await generateTitle('user: 帮我修复 login 页面的 toast 不显示的问题')
    console.log('generated title:', title)
    expect(typeof title).toBe('string')
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(100)
  }, 90000)

  // codex headless (codex exec -o <file>, stdin=/dev/null). Empty model → codex's own default.
  it('generateTitle works through the codex management agent', async () => {
    const title = await generateTitle('user: 帮我修复 login 页面的 toast 不显示的问题', { cli: 'codex', model: '' })
    console.log('codex title:', title)
    expect(typeof title).toBe('string')
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(100)
  }, 120000)
})
