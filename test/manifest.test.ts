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

import { contextStrings } from '../src/i18n'

it('renders the maintain block with compact rules + context/protocol paths when provided', () => {
  const { text } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    todo: { id: 'u1', title: 'T', status: '进行中', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'tasks/u1/index.md', progress: null, updatedAt: 1, syncedAt: 0, deleted: false },
    contextDocPath: '/tmp/berth-test/docs/tasks/u1/index.md',
    protocolPath: '/tmp/berth-test/docs/AGENTS.md',
    compactRules: contextStrings('zh-CN').compactRules,
  })
  expect(text).toContain(contextStrings('zh-CN').sectionMaintain)
  expect(text).toContain('/tmp/berth-test/docs/tasks/u1/index.md')
  expect(text).toContain('/tmp/berth-test/docs/AGENTS.md')
  expect(text).toContain('维护规则')
})

it('project manifest points at the project context file when provided', () => {
  const { text } = buildManifest({
    kind: 'project', projectName: 'Berth', docsRoot: DOCS_ROOT,
    projectTodos: [{ title: 'A', detailDoc: 'tasks/a/index.md' }],
    contextDocPath: '/tmp/berth-test/docs/projects/Berth/index.md',
    protocolPath: '/tmp/berth-test/docs/AGENTS.md',
    compactRules: contextStrings('zh-CN').compactRules,
  })
  expect(text).toContain('/tmp/berth-test/docs/projects/Berth/index.md')
})

it('omits the maintain block when no compact rules are provided (back-compat)', () => {
  const { text } = buildManifest({
    kind: 'project', projectName: 'Berth', docsRoot: DOCS_ROOT,
    projectTodos: [{ title: 'A', detailDoc: 'tasks/a/index.md' }],
  })
  expect(text).not.toContain(contextStrings('zh-CN').sectionMaintain)
})

it('keeps the maintain block + paths intact even when the index body overflows the budget', () => {
  // A huge project todo list would, with end-truncation, sever the protocol/context path lines.
  // The maintain block is a protected tail, so it must survive.
  const ctxPath = '/tmp/berth-test/docs/projects/Big/index.md'
  const protoPath = '/tmp/berth-test/docs/AGENTS.md'
  const projectTodos = Array.from({ length: 200 }, (_, i) => ({
    title: `task-number-${i}-with-a-fairly-long-title-to-eat-budget`,
    detailDoc: `tasks/very-long-task-id-${i}-aaaaaaaaaaaaaaaaaaaa/index.md`,
  }))
  const { text } = buildManifest({
    kind: 'project', projectName: 'Big', docsRoot: DOCS_ROOT,
    projectTodos,
    contextDocPath: ctxPath,
    protocolPath: protoPath,
    compactRules: contextStrings('zh-CN').compactRules,
  })
  expect(text).toContain(contextStrings('zh-CN').sectionMaintain)
  expect(text).toContain(ctxPath)
  expect(text).toContain(protoPath)
})
