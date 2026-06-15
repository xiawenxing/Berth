import { describe, it, expect } from 'vitest'
import { buildManifest, detailRefToPath } from '../src/agent/manifest'

const DOCS_ROOT = '/tmp/berth-test/docs'

it('task manifest carries title, progress, detail path, and a progressive-disclosure instruction', () => {
  const { text, addDirs } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    todo: { id: 'u1', title: '加新建会话', status: '进行中', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'projects/20260611N3-berth-p0-foundations-plan.md', progress: '2026-06-11: 起步',
            updatedAt: 1, syncedAt: 0, deleted: false },
  })
  expect(text).toContain('加新建会话')
  expect(text).toContain('2026-06-11: 起步')
  expect(text).toContain('20260611N3-berth-p0-foundations-plan.md')
  expect(text).toMatch(/Read|渐进|progressive/i)
  expect(addDirs).toContain(DOCS_ROOT)
})

it('project manifest lists detail docs of all project todos', () => {
  const { text } = buildManifest({
    kind: 'project', projectName: 'Berth', docsRoot: DOCS_ROOT,
    projectTodos: [
      { title: 'A', detailDoc: 'projects/doc-a.md' },
      { title: 'B', detailDoc: null },
    ],
  })
  expect(text).toContain('doc-a.md')
  expect(text).toContain('Berth')
})

it('renders the task manifest in English when locale=en', () => {
  const { text } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    todo: { id: 'u1', title: 'light the red dot', status: 'In Progress', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'projects/x.md', progress: '2026-06-11: started',
            updatedAt: 1, syncedAt: 0, deleted: false },
  }, 'en')
  expect(text).toContain('Below is a context index')
  expect(text).toContain('## Task')
  expect(text).toContain('- Title: light the red dot')
  expect(text).toContain('## Progress')
  expect(text).not.toContain('上下文索引')   // no zh-CN leakage
})

it('detailRefToPath joins an internal ref onto docsRoot', () => {
  expect(detailRefToPath('tasks/u1/index.md', DOCS_ROOT)).toBe('/tmp/berth-test/docs/tasks/u1/index.md')
  expect(detailRefToPath(null, DOCS_ROOT)).toBeNull()
})
