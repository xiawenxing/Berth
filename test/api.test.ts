import { describe, it, expect, afterAll, vi, beforeEach } from 'vitest'
import type { Server } from 'node:http'

// ── Mock store-singleton so tests control getStore() + getCache() ─────────────
// These must be declared before any imports that pull in api.ts
const mockEdgesByTodo = vi.fn(() => new Map<string, string[]>())
const mockTodoKeyForSession = vi.fn((_id: string) => null as string | null)
const mockRemoveEdgesForSession = vi.fn((..._a: any[]) => {})
const mockAddEdge = vi.fn((..._a: any[]) => {})
const mockSetAttach = vi.fn((..._a: any[]) => {})
const mockSetTitleOverride = vi.fn((..._a: any[]) => {})
const mockAddProjectPath = vi.fn((..._a: any[]) => {})
const mockGetStore = vi.fn((..._a: any[]) => ({
  allPinnedSet: () => new Set<string>(),
  allAttachMap: () => new Map(),
  allTitleOverrides: () => new Map(),
  setPin: vi.fn(),
  setAttach: mockSetAttach,
  setTitleOverride: mockSetTitleOverride,
  edgesByTodo: mockEdgesByTodo,
  todoKeyForSession: mockTodoKeyForSession,
  removeEdgesForSession: mockRemoveEdgesForSession,
  addEdge: mockAddEdge,
  allArchivedSet: () => new Set<string>(),
  setArchived: vi.fn(),
  allProjectPaths: () => new Map(),
  addProjectPath: mockAddProjectPath,
  getSetting: (k: string) => mockSettings.get(k) ?? null,
  setSetting: (k: string, v: string) => { mockSettings.set(k, v) },
  allSessionImportDirs: () => [...mockImportDirs],
  addSessionImportDir: (cwd: string) => { mockImportDirs.add(cwd) },
  removeSessionImportDir: (cwd: string) => { mockImportDirs.delete(cwd) },
}))
const mockImportDirs = new Set<string>()
const mockSettings = new Map<string, string>()
const mockGetCache = vi.fn((..._a: any[]) => [] as any[])

vi.mock('../src/server/store-singleton', () => ({
  getStore: (...a: any[]) => mockGetStore(...a),
  getCache: (...a: any[]) => mockGetCache(...a),
  refresh: vi.fn(),
}))

// ── Mock data/tasks domain module ─────────────────────────────────────────────
const mockListTasks = vi.fn((..._a: any[]): any[] => [])
const mockCreateTask = vi.fn(async (..._a: any[]) => ({
  status: 'created' as const,
  record: { id: 'r', title: 'test', project: 'Berth' },
}))

vi.mock('../src/data/tasks', () => ({
  listTasks: (...a: any[]) => mockListTasks(...a),
  createTask: (...a: any[]) => mockCreateTask(...a),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))

// ── Mock data/projects domain module ──────────────────────────────────────────
vi.mock('../src/data/projects', () => ({
  listProjects: vi.fn(() => []),
  createProject: vi.fn(),
}))

// ── Mock agent modules ────────────────────────────────────────────────────────
vi.mock('../src/agent/index', () => ({
  generateTitle: vi.fn(async () => 'mocked title'),
}))
vi.mock('../src/agent/transcript', () => ({
  extractUserGist: vi.fn(() => ''),
}))

// ── Mock pty-ws so its node-pty imports don't load (createApp never wires WS) ─
vi.mock('../src/server/pty-ws', () => ({
  createPtyWss: vi.fn(),
}))

// ── Mock reconcile so refresh has no side-effects ────────────────────────────
vi.mock('../src/server/reconcile', () => ({
  reconcileLaunchIntents: vi.fn(),
}))

import { createApp } from '../src/server/index'
// pty-registry is NOT mocked here — drive the real singleton so /api/sessions reflects live activity.
import { registerPty, killPty } from '../src/server/pty-registry'

let server: Server
function listen(): Promise<number> {
  return new Promise(r => { server = createApp().listen(0, () => r((server.address() as any).port)) })
}
afterAll(() => server?.close())

function fakePty() {
  return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} } as any
}

beforeEach(() => {
  mockEdgesByTodo.mockReturnValue(new Map<string, string[]>())
  mockTodoKeyForSession.mockReturnValue(null)
  mockGetCache.mockReturnValue([])
  mockListTasks.mockReturnValue([])
  mockCreateTask.mockResolvedValue({ status: 'created', record: { id: 'r', title: 'test', project: 'Berth' } })
  mockSetTitleOverride.mockClear()
  mockSettings.clear()
  mockImportDirs.clear()
})

describe('session-dirs API', () => {
  it('lists, adds (normalizing trailing slash), and removes import directories', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    expect((await (await fetch(`${base}/session-dirs`)).json() as any).dirs).toEqual([])

    const add = await fetch(`${base}/session-dirs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/Users/me/work/' }),
    })
    expect(add.status).toBe(200)
    expect((await (await fetch(`${base}/session-dirs`)).json() as any).dirs).toEqual(['/Users/me/work'])

    const del = await fetch(`${base}/session-dirs`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/Users/me/work' }),
    })
    expect(del.status).toBe(200)
    expect((await (await fetch(`${base}/session-dirs`)).json() as any).dirs).toEqual([])
  })

  it('rejects an empty cwd', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-dirs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '   ' }),
    })
    expect(r.status).toBe(400)
  })
})

describe('settings API – task status/priority vocabularies', () => {
  it('GET /settings returns default statuses + priorities when unset', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/settings`)
    const j = await r.json() as any
    expect(j.statuses).toContain('待办')
    expect(j.priorities).toEqual(['P0', 'P1', 'P2', 'P3'])
  })

  it('POST /settings persists edited lists and echoes them back', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/settings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statuses: ['todo', 'done'], priorities: ['hi', 'lo'] }),
    })
    const j = await r.json() as any
    expect(r.status).toBe(200)
    expect(j.statuses).toEqual(['todo', 'done'])
    expect(j.priorities).toEqual(['hi', 'lo'])
    // and a subsequent GET reflects the stored values
    const r2 = await fetch(`http://localhost:${port}/api/settings`)
    expect(((await r2.json()) as any).statuses).toEqual(['todo', 'done'])
  })

  it('POST /settings rejects an empty status list (400)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/settings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statuses: [] }),
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as any).error).toBeTruthy()
  })
})

describe('settings API – agents config', () => {
  it('GET /settings includes the default agents config', async () => {
    const port = await listen()
    const j = await (await fetch(`http://localhost:${port}/api/settings`)).json() as any
    expect(j.agents.list.map((a: any) => a.cli).sort()).toEqual(['claude', 'coco', 'codex'])
    expect(j.agents.berthAgentCli).toBe('claude')
    expect(j.agents.berthAgentModel).toBe('claude-haiku-4-5')
    expect(j.agents.headlessClis).toEqual(['claude', 'codex'])
  })

  it('POST /settings persists an agents patch and echoes it back', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/settings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agents: {
        list: [
          { cli: 'claude', enabled: true, model: 'claude-opus-4-8' },
          { cli: 'codex', enabled: false, model: null },
          { cli: 'coco', enabled: true, model: null },
        ],
        berthAgentModel: 'claude-sonnet-4-6',
      } }),
    })
    expect(r.status).toBe(200)
    const j = await r.json() as any
    expect(j.agents.list.find((a: any) => a.cli === 'claude').model).toBe('claude-opus-4-8')
    expect(j.agents.list.find((a: any) => a.cli === 'codex').enabled).toBe(false)
    expect(j.agents.berthAgentModel).toBe('claude-sonnet-4-6')
    // a subsequent GET reflects the stored values
    const j2 = await (await fetch(`http://localhost:${port}/api/settings`)).json() as any
    expect(j2.agents.berthAgentModel).toBe('claude-sonnet-4-6')
  })

  it('POST /settings rejects a non-headless berth agent cli (400)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/settings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agents: { berthAgentCli: 'coco' } }),
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as any).error).toBeTruthy()
  })
})

describe('pin/attach API – input validation (always)', () => {
  it('rejects /pin with missing body fields (400)', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    const bad1 = await fetch(`${base}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(bad1.status).toBe(400)
    const body1 = await bad1.json() as any
    expect(body1.error).toBeTruthy()

    const bad2 = await fetch(`${base}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'abc' }),   // missing 'on'
    })
    expect(bad2.status).toBe(400)

    const bad3 = await fetch(`${base}/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'P' }),     // missing sessionId
    })
    expect(bad3.status).toBe(400)
  })
})

describe('/api/sessions – live activity field (always)', () => {
  it('reports activity from the pty-registry: running for a live session, null otherwise', async () => {
    const sess = { sessionId: 's-live-1', cli: 'claude', cwd: '/x', title: 't', updatedAt: 100, deleted: false, copies: [] }
    mockGetCache.mockReturnValue([sess])
    const port = await listen()
    const base = `http://localhost:${port}/api`

    // No live pty yet → activity is null.
    const before = await (await fetch(`${base}/sessions`)).json() as any[]
    expect(before.find(s => s.sessionId === 's-live-1')?.activity).toBeNull()

    // Register a live pty mid-turn → activity becomes 'running'.
    registerPty('s-live-1', fakePty(), { running: true })
    const after = await (await fetch(`${base}/sessions`)).json() as any[]
    expect(after.find(s => s.sessionId === 's-live-1')?.activity).toBe('running')

    killPty('s-live-1')
  })
})

describe('PATCH /api/sessions/:id/title', () => {
  it('persists a manual session title override', async () => {
    mockGetCache.mockReturnValue([{ sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [] }])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/sessions/s1/title`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  New title  ' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'New title' })
    expect(mockSetTitleOverride).toHaveBeenCalledWith('s1', 'New title')
  })

  it('rejects an empty title and unknown sessions', async () => {
    mockGetCache.mockReturnValue([{ sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [] }])
    const port = await listen()

    const empty = await fetch(`http://localhost:${port}/api/sessions/s1/title`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    })
    expect(empty.status).toBe(400)

    const missing = await fetch(`http://localhost:${port}/api/sessions/nope/title`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
    })
    expect(missing.status).toBe(404)
    expect(mockSetTitleOverride).not.toHaveBeenCalled()
  })
})

const live = process.env.BERTH_LIVE === '1' ? describe : describe.skip
live('pin/attach API – round-trip through /api/sessions (BERTH_LIVE)', () => {
  it('persists pin + attach and reflects them in /api/sessions, then cleans up', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    // Trigger a full refresh so the cache is populated
    await fetch(`${base}/refresh`, { method: 'POST' })

    const sessions = await (await fetch(`${base}/sessions`)).json() as any[]
    expect(sessions.length).toBeGreaterThan(0)
    const id: string = sessions[0].sessionId

    // Pin it
    const pinRes = await fetch(`${base}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, on: true }),
    })
    expect(pinRes.status).toBe(200)
    expect((await pinRes.json() as any).ok).toBe(true)

    // Attach to a project
    const attachRes = await fetch(`${base}/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, projectId: 'TEST_PROJ' }),
    })
    expect(attachRes.status).toBe(200)
    expect((await attachRes.json() as any).ok).toBe(true)

    // Verify reflected in /api/sessions
    const after = await (await fetch(`${base}/sessions`)).json() as any[]
    const row = after.find((s: any) => s.sessionId === id)
    expect(row).toBeDefined()
    expect(row.pinned).toBe(true)
    expect(row.projectId).toBe('TEST_PROJ')
    expect(row.attachState).toBe('confirmed')

    // Cleanup: unpin + detach so ~/.berth/berth.sqlite is not left dirty
    await fetch(`${base}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, on: false }),
    })
    await fetch(`${base}/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, projectId: null, state: 'unconfirmed' }),
    })
  }, 60_000)  // refresh can take several seconds over ~1400 sessions
})

// ── T7: POST /api/todos ───────────────────────────────────────────────────────
describe('POST /api/todos', () => {
  it('returns createTask result (200) on valid text', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    mockCreateTask.mockResolvedValueOnce({ status: 'created', record: { id: 'r1', title: '记一条', project: 'Berth' } })

    const res = await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '记一条' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('created')
    expect(body.record.id).toBe('r1')
  })

  it('returns 400 when text is missing or empty', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    const noText = await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(noText.status).toBe(400)

    const emptyText = await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })
    expect(emptyText.status).toBe(400)

    const nonString = await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 42 }),
    })
    expect(nonString.status).toBe(400)
  })

  it('returns 502 when createTask throws', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    mockCreateTask.mockRejectedValueOnce(new Error('store down'))

    const res = await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '新建一条' }),
    })
    expect(res.status).toBe(502)
  })

  it('forwards projectId, confirm, createOption from body', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    mockCreateTask.mockResolvedValueOnce({ status: 'created', record: { id: 'r2', title: 'x', project: 'P' } })

    await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x', projectId: 'P', confirm: true, createOption: false }),
    })
    // createTask(store, docStore, text, opts)
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'x',
      expect.objectContaining({ projectId: 'P', confirm: true, createOption: false }),
    )
  })
})

// ── T7: GET /api/sessions includes todoKey from edges ────────────────────────
describe('GET /api/sessions with todoKey', () => {
  it('includes todoKey in each session derived from edgesByTodo reverse map', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    const KNOWN = 'sess-abc'
    mockGetCache.mockReturnValue([
      { sessionId: KNOWN, cli: 'claude', cwd: '/c', title: 'T', updatedAt: 1000, deleted: false, copies: [] },
      { sessionId: 'sess-other', cli: 'codex', cwd: '/d', title: null, updatedAt: 900, deleted: false, copies: [] },
    ])
    // edgesByTodo returns rec_A → [KNOWN]
    mockEdgesByTodo.mockReturnValue(new Map([['rec_A', [KNOWN]]]))

    const res = await fetch(`${base}/sessions`)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    const known = body.find((s: any) => s.sessionId === KNOWN)
    expect(known).toBeDefined()
    expect(known.todoKey).toBe('rec_A')
    const other = body.find((s: any) => s.sessionId === 'sess-other')
    expect(other.todoKey).toBeNull()
  })
})

// ── T7: GET /api/todos includes sessions[] ────────────────────────────────────
describe('GET /api/todos with sessions[]', () => {
  it('attaches sessions array to each task from edgesByTodo (keyed by task id)', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    mockListTasks.mockReturnValueOnce([
      { id: 'task_X', title: 'Task X', status: '进行中', priority: 'P1', project: 'Berth', detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false },
      { id: 'task_Y', title: 'Task Y', status: '待办', priority: 'P2', project: null, detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false },
    ])
    mockEdgesByTodo.mockReturnValue(new Map([['task_X', ['sess-1', 'sess-2']]]))

    const res = await fetch(`${base}/todos`)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.todos)).toBe(true)
    const tx = body.todos.find((t: any) => t.id === 'task_X')
    expect(tx.sessions).toEqual(['sess-1', 'sess-2'])
    const ty = body.todos.find((t: any) => t.id === 'task_Y')
    expect(ty.sessions).toEqual([])
    expect(body).toHaveProperty('error')
  })
})

// ── POST /api/edge: assign an existing session to a task ───────────────────────
describe('POST /api/edge', () => {
  it('assigns a session to a task (clears prior edges, adds the new one, confirms project)', async () => {
    mockRemoveEdgesForSession.mockClear(); mockAddEdge.mockClear(); mockSetAttach.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/edge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', todoKey: 'rec_X', projectId: 'Berth' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRemoveEdgesForSession).toHaveBeenCalledWith('sess-1')
    expect(mockAddEdge).toHaveBeenCalledWith('rec_X', 'sess-1')
    expect(mockSetAttach).toHaveBeenCalledWith('sess-1', 'Berth', 'confirmed')
  })

  it('detaches when todoKey is null (clears edges, no addEdge)', async () => {
    mockRemoveEdgesForSession.mockClear(); mockAddEdge.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/edge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', todoKey: null }),
    })
    expect(res.status).toBe(200)
    expect(mockRemoveEdgesForSession).toHaveBeenCalledWith('sess-1')
    expect(mockAddEdge).not.toHaveBeenCalled()
  })

  it('400 when sessionId missing', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/edge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todoKey: 'rec_X' }),
    })
    expect(res.status).toBe(400)
  })
})
