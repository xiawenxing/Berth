import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Server } from 'node:http'

// ── Spy on the data-changed broadcast (Task B1) ───────────────────────────────
const broadcast = vi.hoisted(() => vi.fn())
vi.mock('../src/server/status-ws', () => ({
  broadcastDataChanged: broadcast,
  createStatusWss: () => ({}),
}))

// ── Mock store-singleton so importing api.ts doesn't open a real SQLite DB, and
//    so the mutation handlers can reach their success paths. ───────────────────
const mockRemoveEdgesForSession = vi.fn((..._a: any[]) => {})
const mockAddEdge = vi.fn((..._a: any[]) => {})
const mockSetAttach = vi.fn((..._a: any[]) => {})
const mockSetTaskDdl = vi.fn((..._a: any[]) => {})
const mockEdgesByTodo = vi.fn(() => new Map<string, string[]>())
const mockAllTitleOverrides = vi.fn(() => new Map<string, string>())
const mockGetStore = vi.fn((..._a: any[]) => ({
  removeEdgesForSession: mockRemoveEdgesForSession,
  addEdge: mockAddEdge,
  setAttach: mockSetAttach,
  setTaskDdl: mockSetTaskDdl,
  edgesByTodo: mockEdgesByTodo,
  allTitleOverrides: mockAllTitleOverrides,
}))
vi.mock('../src/server/store-singleton', () => ({
  getStore: (...a: any[]) => mockGetStore(...a),
  getCache: vi.fn(() => [] as any[]),
  refresh: vi.fn(),
  storeRoots: vi.fn(() => ({})),
}))

// ── Mock the data/tasks domain so create/update/delete reach success ──────────
const mockCreateTask = vi.fn(async (..._a: any[]) => ({ status: 'created' as const, record: { id: 'r' } }))
const mockUpdateTask = vi.fn((..._a: any[]) => ({ ok: true }))
const mockDeleteTask = vi.fn((..._a: any[]) => {})
const mockListTasks = vi.fn((..._a: any[]): any[] => [{ id: 't1', title: 'task' }])
vi.mock('../src/data/tasks', () => ({
  listTasks: (...a: any[]) => mockListTasks(...a),
  createTask: (...a: any[]) => mockCreateTask(...a),
  updateTask: (...a: any[]) => mockUpdateTask(...a),
  deleteTask: (...a: any[]) => mockDeleteTask(...a),
}))

// ── Mock the docstore so getDocStore() doesn't open a real on-disk store ──────
vi.mock('../src/data/docstore', () => ({
  getDocStore: vi.fn(() => ({})),
  getDocsRoot: vi.fn(() => '/tmp/docs'),
}))

// ── Mock title regeneration so POST /todos/:id/title reaches success ──────────
const mockGenerateAndApplyTaskTitle = vi.fn(async (..._a: any[]) => ({ ok: true, title: 'new' }))
vi.mock('../src/data/task-title', () => ({
  generateAndApplyTaskTitle: (...a: any[]) => mockGenerateAndApplyTaskTitle(...a),
}))

// ── Mock agent config so resolveBerthAgent() doesn't touch real config ────────
vi.mock('../src/data/agent-config', () => ({
  getAgentConfig: vi.fn(() => ({})),
  setAgentConfig: vi.fn(),
  resolveBerthAgent: vi.fn(() => ({ cli: 'claude' })),
}))

import express from 'express'
import { api } from '../src/server/api'

function mount() {
  const app = express()
  app.use(express.json())
  app.use('/api', api)
  return app
}

async function call(path: string, method: string, body?: unknown): Promise<number> {
  const app = mount()
  const srv: Server = app.listen(0)
  const port = (srv.address() as any).port
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return r.status
  } finally {
    await new Promise<void>(resolve => srv.close(() => resolve()))
  }
}

describe('task mutations broadcast a data-changed signal', () => {
  beforeEach(() => broadcast.mockClear())

  it('POST /edge broadcasts on success', async () => {
    const status = await call('/edge', 'POST', { sessionId: 's', todoKey: 't' })
    expect(status).toBe(200)
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('POST /edge does NOT broadcast on a validation failure (missing sessionId)', async () => {
    const status = await call('/edge', 'POST', {})
    expect(status).toBe(400)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('POST /todos broadcasts on success', async () => {
    const status = await call('/todos', 'POST', { text: 'hello' })
    expect(status).toBe(200)
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('POST /todos does NOT broadcast on a validation failure (empty text)', async () => {
    const status = await call('/todos', 'POST', { text: '' })
    expect(status).toBe(400)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('PATCH /todos/:id broadcasts on success', async () => {
    const status = await call('/todos/t1', 'PATCH', { title: 'renamed' })
    expect(status).toBe(200)
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('DELETE /todos/:id broadcasts on success', async () => {
    const status = await call('/todos/t1', 'DELETE')
    expect(status).toBe(200)
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('POST /todos/:id/title broadcasts on success', async () => {
    const status = await call('/todos/t1/title', 'POST', {})
    expect(status).toBe(200)
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it('POST /todos/:id/title does NOT broadcast for an unknown task (404)', async () => {
    mockListTasks.mockReturnValueOnce([])
    const status = await call('/todos/missing/title', 'POST', {})
    expect(status).toBe(404)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
