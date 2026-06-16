import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Avoid loading the real store singleton (which opens ~/.berth/berth.sqlite + bootstraps).
vi.mock('../src/server/store-singleton', () => ({ getStore: vi.fn(), getCache: vi.fn(() => []) }))
vi.mock('../src/data/tasks', () => ({
  listTasks: vi.fn(() => []),
  updateTask: vi.fn(() => ({ ok: true })),
}))

import { planFreshLaunch, shouldAdvanceTodoOnLaunch, advanceTodoOnLaunch, buildTaskInitialPrompt, codexActivityStateForSession } from '../src/server/pty-ws'
import { updateTask } from '../src/data/tasks'

const DOCS = '/tmp/berth-test/docs'
const fakeStore = {} as any
// A store whose app_settings drive getTaskFieldConfig. Empty → Chinese defaults (待办/进行中/…).
function storeWith(settings: Record<string, string> = {}) {
  return { getSetting: (k: string) => settings[k] ?? null, setSetting: vi.fn() } as any
}

beforeEach(() => { vi.clearAllMocks() })

function rollout(lines: any[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-pty-ws-codex-'))
  const p = join(dir, 'rollout.jsonl')
  writeFileSync(p, lines.map(x => JSON.stringify(x)).join('\n') + '\n')
  return p
}

describe('planFreshLaunch', () => {
  it('claude/coco get a minted id and immediate binding; codex stays pending', () => {
    const todos = [{ id: 'task_A', title: 'T', project: 'P', detailDoc: null, progress: null, status: '进行中', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false }] as any
    const claude = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_A', projectId: 'P' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(claude.sessionId).toBe('uuid-mint')
    expect(claude.intent.bound).toBe(true)
    expect(claude.intent.id).toBe('uuid-mint')
    expect(claude.intent.createdAt).toBe(1000)
    expect(claude.bindNow).toEqual({ sessionId: 'uuid-mint', todoKey: 'task_A', projectId: 'P' })

    const coco = planFreshLaunch({ cli: 'coco', cwd: '/c', todoKey: 'task_A', projectId: 'P' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(coco.sessionId).toBe('uuid-mint')
    expect(coco.intent.bound).toBe(true)

    const codex = planFreshLaunch({ cli: 'codex', cwd: '/c', todoKey: 'task_A', projectId: 'P' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(codex.sessionId).toBeNull()
    expect(codex.intent.bound).toBe(false)
    expect(codex.bindNow).toBeNull()
  })

  it('builds a task manifestInput from the matching task', () => {
    const todos = [{ id: 'task_A', title: '加新建会话', project: 'Berth', detailDoc: 'projects/doc-a.md', progress: '起步', status: '进行中', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false }] as any
    const plan = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_A', projectId: 'Berth' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(plan.manifestInput.kind).toBe('task')
    if (plan.manifestInput.kind === 'task') {
      expect(plan.manifestInput.todo.title).toBe('加新建会话')
      expect(plan.manifestInput.projectName).toBe('Berth')
    }
  })

  it('task launch yields an actionable initialPrompt naming the task; project/plain launch does not', () => {
    const todos = [{ id: 'task_A', title: '加新建会话', project: 'Berth', detailDoc: null, progress: null, status: '待办', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false }] as any
    const task = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_A', projectId: 'Berth' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(task.initialPrompt).toBeTruthy()
    expect(task.initialPrompt).toContain('加新建会话')

    const proj = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: null, projectId: 'Berth' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(proj.initialPrompt).toBeNull()

    const missing = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_MISSING', projectId: null }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(missing.initialPrompt).toBeNull()
  })

  it('first prompt is just the title-naming directive; the detail-doc path is NOT inlined (it rides in the manifest)', () => {
    const withDoc = [{ id: 'task_A', title: '修红点', project: 'Berth', detailDoc: 'projects/foo.md', progress: null, status: null, priority: null, updatedAt: 1, syncedAt: 0, deleted: false }] as any
    const a = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_A', projectId: 'Berth' }, withDoc, 1000, () => 'm', DOCS)
    expect(a.initialPrompt).toContain('修红点')
    expect(a.initialPrompt).not.toContain('详情文档')
    expect(a.initialPrompt).not.toContain('projects/foo.md')
    // no finish/maintenance clutter either — that lives in the manifest's maintenance block
    expect(a.initialPrompt).not.toContain('进展日志')

    const noDoc = [{ id: 'task_A', title: '修红点', project: 'Berth', detailDoc: null, progress: null, status: null, priority: null, updatedAt: 1, syncedAt: 0, deleted: false }] as any
    const b = planFreshLaunch({ cli: 'claude', cwd: '/c', todoKey: 'task_A', projectId: 'Berth' }, noDoc, 1000, () => 'm', DOCS)
    expect(b.initialPrompt).toContain('修红点')
    expect(b.initialPrompt).not.toContain('详情文档')
  })

  it('builds a project manifestInput from projectId when no todoKey', () => {
    const todos = [
      { id: 'task_A', title: 'A', project: 'Berth', detailDoc: 'projects/d-a.md', progress: null, status: null, priority: null, updatedAt: 1, syncedAt: 0, deleted: false },
      { id: 'task_B', title: 'B', project: 'Other', detailDoc: 'projects/d-b.md', progress: null, status: null, priority: null, updatedAt: 1, syncedAt: 0, deleted: false },
    ] as any
    const plan = planFreshLaunch({ cli: 'codex', cwd: '/c', todoKey: null, projectId: 'Berth' }, todos, 1000, () => 'uuid-mint', DOCS)
    expect(plan.manifestInput.kind).toBe('project')
    if (plan.manifestInput.kind === 'project') {
      expect(plan.manifestInput.projectName).toBe('Berth')
      expect(plan.manifestInput.projectTodos.map(t => t.title)).toEqual(['A'])
    }
  })
})

describe('codexActivityStateForSession', () => {
  it('detects a Codex session that is already mid-turn when resumed/opened', () => {
    const contentSourcePath = rollout([
      { timestamp: '2026-06-16T01:00:00.000Z', type: 'session_meta', payload: { id: 's1' } },
      { timestamp: '2026-06-16T01:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    ])
    expect(codexActivityStateForSession({ cli: 'codex', contentSourcePath })).toBe('running')
  })

  it('does not mark non-Codex sessions running from transcript lifecycle events', () => {
    const contentSourcePath = rollout([
      { timestamp: '2026-06-16T01:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    ])
    expect(codexActivityStateForSession({ cli: 'claude', contentSourcePath })).toBe('unknown')
  })
})

describe('buildTaskInitialPrompt i18n', () => {
  const todo = { id: 't', title: 'fix the thing', project: 'P', detailDoc: null, progress: null, status: 'Todo', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false } as any
  it('defaults to zh-CN', () => {
    expect(buildTaskInitialPrompt(todo)).toContain('请开始处理任务')
  })
  it('renders English when locale=en — just the title directive, no detail/finish lines', () => {
    const p = buildTaskInitialPrompt(todo, 'en')
    expect(p).toContain('Please start working on the task: "fix the thing"')
    expect(p).not.toContain('Detail doc')
    expect(p).not.toContain('请开始处理任务')
  })
})

describe('task status transition on launch', () => {
  it('advances only pending tasks to 进行中 (default zh-CN vocabulary)', async () => {
    const store = storeWith()
    const pending = { id: 'task_A', title: 'T', project: 'P', detailDoc: null, progress: null, status: '待办', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false } as any
    await expect(advanceTodoOnLaunch(store, pending)).resolves.toBe(true)
    expect(updateTask).toHaveBeenCalledWith(store, 'task_A', { status: '进行中' })
    expect(pending.status).toBe('进行中')
  })

  it('leaves non-pending statuses untouched so users can manually move tasks back', async () => {
    const store = storeWith()
    const inProgress = { id: 'task_B', title: 'T', project: 'P', detailDoc: null, progress: null, status: '进行中', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false } as any
    const blocked = { id: 'task_C', title: 'T', project: 'P', detailDoc: null, progress: null, status: '阻塞', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false } as any
    expect(shouldAdvanceTodoOnLaunch(inProgress, '待办')).toBe(false)
    expect(shouldAdvanceTodoOnLaunch(blocked, '待办')).toBe(false)
    await expect(advanceTodoOnLaunch(store, inProgress)).resolves.toBe(false)
    await expect(advanceTodoOnLaunch(store, blocked)).resolves.toBe(false)
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('advances under a custom (English) status vocabulary, not just literal 待办/进行中', async () => {
    const store = storeWith({ taskStatuses: JSON.stringify(['Todo', 'In Progress', 'Blocked', 'Done', 'Cancelled']), taskDefaultStatus: 'Todo' })
    const todo = { id: 'task_E', title: 'T', project: 'P', detailDoc: null, progress: null, status: 'Todo', priority: 'P1', updatedAt: 1, syncedAt: 0, deleted: false } as any
    await expect(advanceTodoOnLaunch(store, todo)).resolves.toBe(true)
    expect(updateTask).toHaveBeenCalledWith(store, 'task_E', { status: 'In Progress' })
    expect(todo.status).toBe('In Progress')
  })
})
