import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from 'vitest'
import type { Server } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockExecFile = vi.hoisted(() => vi.fn())
const mockGenerateTaskTitle = vi.hoisted(() => vi.fn(async (..._a: any[]) => '智能任务标题'))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: (...a: any[]) => mockExecFile(...a),
}))

// ── Mock store-singleton so tests control getStore() + getCache() ─────────────
// These must be declared before any imports that pull in api.ts
const mockEdgesByTodo = vi.fn(() => new Map<string, string[]>())
const mockTodoKeyForSession = vi.fn((_id: string) => null as string | null)
const mockRemoveEdgesForSession = vi.fn((..._a: any[]) => {})
const mockAddEdge = vi.fn((..._a: any[]) => {})
const mockSetAttach = vi.fn((..._a: any[]) => {})
const mockSetPin = vi.fn((..._a: any[]) => {})
const mockSetTitleOverride = vi.fn((..._a: any[]) => {})
const mockAddProjectPath = vi.fn((..._a: any[]) => {})
const mockSetPathEnabled = vi.fn((..._a: any[]) => {})
const mockRemoveProjectPath = vi.fn((..._a: any[]) => {})
const mockAddSessionImport = vi.fn((..._a: any[]) => {})
const mockRemoveSessionImport = vi.fn((..._a: any[]) => {})
const mockRemoveLaunchIntentsForSession = vi.fn((..._a: any[]) => {})
const mockHideSession = vi.fn((..._a: any[]) => {})
const mockUpdateTaskFields = vi.fn((..._a: any[]) => {})
const mockSetTaskDdl = vi.fn((..._a: any[]) => {})
const mockTaskDdls = new Map<string, string>()
const mockGetStore = vi.fn((..._a: any[]) => ({
  allPinnedSet: () => new Set<string>(),
  allAttachMap: () => new Map(),
  allTitleOverrides: () => new Map(),
  launchIntentCwdBySession: () => new Map<string, string>(),
  setPin: mockSetPin,
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
  setPathEnabled: mockSetPathEnabled,
  removeProjectPath: mockRemoveProjectPath,
  addSessionImport: mockAddSessionImport,
  removeSessionImport: mockRemoveSessionImport,
  removeLaunchIntentsForSession: mockRemoveLaunchIntentsForSession,
  allSessionImportSet: () => new Set<string>(),
  hideSession: mockHideSession,
  unhideSession: vi.fn(),
  allHiddenSessionSet: () => new Set<string>(),
  allBoundLaunchSessionIds: () => new Set<string>(),
  updateTaskFields: mockUpdateTaskFields,
  setTaskDdl: mockSetTaskDdl,
  allTaskDdls: () => mockTaskDdls,
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
  // visibleSessions = on-disk cache ∪ in-flight launches; these tests exercise the disk arm, so it
  // mirrors getCache(). The live-PTY arm is unit-tested directly via synthLaunchingSessions.
  visibleSessions: (...a: any[]) => mockGetCache(...a),
  refresh: vi.fn(),
}))

// ── Mock data/tasks domain module ─────────────────────────────────────────────
const mockListTasks = vi.fn((..._a: any[]): any[] => [])
const mockCreateTask = vi.fn(async (..._a: any[]) => ({
  status: 'created' as const,
  record: { id: 'r', title: 'test', project: 'Berth' },
}))
const mockUpdateTask = vi.fn((...a: any[]) => {
  const patch = a[2]
  const has = ['title', 'priority', 'status', 'progress'].some(k => patch?.[k] !== undefined)
  if (!has) throw new Error('no editable fields in patch')
  return { ok: true }
})

vi.mock('../src/data/tasks', () => ({
  listTasks: (...a: any[]) => mockListTasks(...a),
  createTask: (...a: any[]) => mockCreateTask(...a),
  // Mirror the real updateTask: it throws when the patch carries no editable TaskField.
  updateTask: (...a: any[]) => mockUpdateTask(...a),
  deleteTask: vi.fn(),
}))

// ── Mock data/projects domain module ──────────────────────────────────────────
vi.mock('../src/data/projects', () => ({
  listProjects: vi.fn(() => []),
  createProject: vi.fn(),
  updateProject: vi.fn((_store: any, id: string, patch: any) => ({ id, name: patch.name ?? 'Project', hue: patch.hue })),
  deleteProject: vi.fn(),
}))

// ── Mock agent modules ────────────────────────────────────────────────────────
vi.mock('../src/agent/index', () => ({
  generateTitle: vi.fn(async () => 'mocked title'),
  generateTaskTitle: (...a: any[]) => mockGenerateTaskTitle(...a),
  parseStructuredSummary: vi.fn((raw: string) => ({ headline: raw, progress: [], milestones: [] })),
}))
const mockExtractConversation = vi.hoisted(() => vi.fn((..._a: any[]) => ''))
vi.mock('../src/agent/transcript', () => ({
  extractTitleContext: vi.fn(() => ''),
  extractUserGist: vi.fn(() => ''),
  titleInputFromTranscript: vi.fn((text: string) => text.trim() ? 'sampled title clue' : ''),
  extractConversation: (...a: any[]) => mockExtractConversation(...a),
}))

// ── Mock pty-ws so its node-pty imports don't load (createApp never wires WS) ─
vi.mock('../src/server/pty-ws', () => ({
  createPtyWss: vi.fn(),
}))

// ── Mock context-doc so ensureContextDoc doesn't touch the filesystem ─────────
const mockEnsureContextDoc = vi.fn((..._a: any[]) => ({
  ref: 'projects/Berth/index.md',
  abs: '/tmp/docs/projects/Berth/index.md',
  created: true,
}))
vi.mock('../src/data/context-doc', () => ({
  ensureContextDoc: (...a: any[]) => mockEnsureContextDoc(...a),
}))

// ── Mock reconcile so refresh has no side-effects ────────────────────────────
vi.mock('../src/server/reconcile', () => ({
  reconcileLaunchIntents: vi.fn(),
}))

// ── Mock context-consolidate-service so no real CLI/agent runs ────────────────
const mockRunConsolidation = vi.fn().mockResolvedValue({ ok: true, progress: 'p', status: 's', rotated: false })
const mockRunContextUpdate = vi.fn().mockResolvedValue({ ok: true, changed: [], added: [], removed: [], commit: null, rotated: false })
const mockReadTranscript = vi.fn((..._a: any[]) => 'transcript text')
vi.mock('../src/server/context-consolidate-service', () => ({
  runConsolidation: (...a: any[]) => mockRunConsolidation(...a),
  runContextUpdate: (...a: any[]) => mockRunContextUpdate(...a),
  readTranscript: (...a: any[]) => mockReadTranscript(...a),
}))

// ── Spy on doc-git.revertCommit so /doc/revert never touches real git, while
//    keeping the real exports docstore/store-singleton depend on intact. ───────
const mockRevertCommit = vi.fn((..._a: any[]): { ok: boolean; reason?: string } => ({ ok: true }))
vi.mock('../src/data/doc-git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/doc-git')>()),
  revertCommit: (root: string, commit: string) => mockRevertCommit(root, commit),
}))

import { createApp } from '../src/server/index'
// pty-registry is NOT mocked here — drive the real singleton so /api/sessions reflects live activity.
import { registerPty, killPty } from '../src/server/pty-registry'
import { InternalAgentBlocked } from '../src/agent/agent-failure'

let server: Server
const tmpRoots: string[] = []
function listen(): Promise<number> {
  return new Promise(r => { server = createApp().listen(0, () => r((server.address() as any).port)) })
}
afterAll(() => server?.close())
afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fakePty() {
  return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} } as any
}

beforeEach(() => {
  mockExecFile.mockReset()
  mockEdgesByTodo.mockReturnValue(new Map<string, string[]>())
  mockTodoKeyForSession.mockReturnValue(null)
  mockGetCache.mockReturnValue([])
  mockListTasks.mockReturnValue([])
  mockCreateTask.mockResolvedValue({ status: 'created', record: { id: 'r', title: 'test', project: 'Berth' } })
  mockUpdateTask.mockClear()
  mockGenerateTaskTitle.mockReset().mockResolvedValue('智能任务标题')
  mockSetTitleOverride.mockClear()
  mockSettings.clear()
  mockImportDirs.clear()
  mockRunContextUpdate.mockReset().mockResolvedValue({ ok: true, changed: [], added: [], removed: [], commit: null, rotated: false })
  mockReadTranscript.mockReset().mockReturnValue('transcript text')
  mockExtractConversation.mockReset().mockReturnValue('')
  mockRevertCommit.mockReset().mockReturnValue({ ok: true })
})

describe('pick-folder API', () => {
  it('treats AppleScript cancel as a cancellation without retrying', async () => {
    mockExecFile.mockImplementationOnce((_bin: string, _args: string[], _opts: any, cb: Function) => {
      const err = Object.assign(new Error('execution error: User canceled. (-128)'), { code: 1 })
      cb(err, '', 'execution error: User canceled. (-128)')
    })

    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/pick-folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default: '/missing/default' }),
    })

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ cancelled: true })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })

  it('retries without the default location when the default path is invalid', async () => {
    mockExecFile
      .mockImplementationOnce((_bin: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error('Can’t get POSIX file "/missing/default".'), '', 'Can’t get POSIX file')
      })
      .mockImplementationOnce((_bin: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, '/Users/me/work/\n', '')
      })

    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/pick-folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default: '/missing/default' }),
    })

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ path: '/Users/me/work' })
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
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

describe('货舱 path + session-import API', () => {
  beforeEach(() => {
    mockSetPathEnabled.mockClear(); mockRemoveProjectPath.mockClear()
    mockAddSessionImport.mockClear(); mockSetAttach.mockClear(); mockAddProjectPath.mockClear()
  })
  const J = { 'Content-Type': 'application/json' }

  it('toggles a path enabled flag', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/projects/path/toggle`, {
      method: 'POST', headers: J, body: JSON.stringify({ projectId: 'P', cwd: '/x', enabled: false }),
    })
    expect(r.status).toBe(200)
    expect(mockSetPathEnabled).toHaveBeenCalledWith('P', '/x', false)
  })

  it('rejects a toggle without a boolean enabled', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/projects/path/toggle`, {
      method: 'POST', headers: J, body: JSON.stringify({ projectId: 'P', cwd: '/x' }),
    })
    expect(r.status).toBe(400)
  })

  it('removes a registered path (collision-free POST, not shadowed by DELETE /projects/:id)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/projects/path/remove`, {
      method: 'POST', headers: J, body: JSON.stringify({ projectId: 'P', cwd: '/x' }),
    })
    expect(r.status).toBe(200)
    expect(mockRemoveProjectPath).toHaveBeenCalledWith('P', '/x')
  })

  it('add-path defaults enabled to true, honors explicit false', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api/projects/add-path`
    await fetch(base, { method: 'POST', headers: J, body: JSON.stringify({ projectId: 'P', cwd: '/a' }) })
    expect(mockAddProjectPath).toHaveBeenCalledWith('P', '/a', false, true)
    await fetch(base, { method: 'POST', headers: J, body: JSON.stringify({ projectId: 'P', cwd: '/b', enabled: false }) })
    expect(mockAddProjectPath).toHaveBeenCalledWith('P', '/b', false, false)
  })

  it('imports sessions into a project (addSessionImport + attach)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s1', 's2'], projectId: 'P' }),
    })
    expect(r.status).toBe(200)
    expect(mockAddSessionImport).toHaveBeenCalledWith('s1')
    expect(mockAddSessionImport).toHaveBeenCalledWith('s2')
    expect(mockSetAttach).toHaveBeenCalledWith('s1', 'P', 'confirmed')
  })

  it('project-less import marks session_import but does NOT attach', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s9'] }),
    })
    expect(r.status).toBe(200)
    expect(mockAddSessionImport).toHaveBeenCalledWith('s9')
    expect(mockSetAttach).not.toHaveBeenCalled()
  })
})

describe('session removal API (detach / un-import)', () => {
  beforeEach(() => {
    mockSetAttach.mockClear()
    mockRemoveSessionImport.mockClear()
    mockRemoveEdgesForSession.mockClear()
    mockSetPin.mockClear()
    mockRemoveLaunchIntentsForSession.mockClear()
    mockHideSession.mockClear()
  })
  const J = { 'Content-Type': 'application/json' }

  it('detaches sessions from their project and task (attach → null, edge cleared)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/sessions/detach`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s1', 's2'] }),
    })
    expect(r.status).toBe(200)
    expect(mockRemoveEdgesForSession).toHaveBeenCalledWith('s1')
    expect(mockRemoveEdgesForSession).toHaveBeenCalledWith('s2')
    expect(mockSetAttach).toHaveBeenCalledWith('s1', null, 'confirmed')
    expect(mockSetAttach).toHaveBeenCalledWith('s2', null, 'confirmed')
    expect(mockRemoveSessionImport).not.toHaveBeenCalled()
  })

  it('rejects detach with no ids', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/sessions/detach`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: [] }),
    })
    expect(r.status).toBe(400)
  })

  it('un-imports sessions (remove visible/organized signals + detach)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import/remove`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s1'] }),
    })
    expect(r.status).toBe(200)
    expect(mockRemoveSessionImport).toHaveBeenCalledWith('s1')
    expect(mockRemoveEdgesForSession).toHaveBeenCalledWith('s1')
    expect(mockSetPin).toHaveBeenCalledWith('s1', false)
    expect(mockSetAttach).toHaveBeenCalledWith('s1', null, 'confirmed')
    expect(mockRemoveLaunchIntentsForSession).toHaveBeenCalledWith('s1')
    expect(mockHideSession).toHaveBeenCalledWith('s1')
  })

  it('rejects un-import with no ids', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import/remove`, {
      method: 'POST', headers: J, body: JSON.stringify({}),
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

  it('forwards projectId, confirm, createOption, and autoTitle from body', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`

    mockCreateTask.mockResolvedValueOnce({ status: 'created', record: { id: 'r2', title: 'x', project: 'P' } })

    await fetch(`${base}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x', projectId: 'P', confirm: true, createOption: false, autoTitle: true }),
    })
    // createTask(store, docStore, text, opts)
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'x',
      expect.objectContaining({ projectId: 'P', confirm: true, createOption: false, autoTitle: true }),
    )
  })
})

describe('POST /api/todos/:id/title', () => {
  it('generates a task title from task clues and linked session titles, then persists it', async () => {
    mockListTasks.mockReturnValue([
      { id: 't1', title: '原始任务标题', status: '待办', priority: 'P1', projectId: 'p1', project: 'Berth', progress: '已有进展', detailDoc: null },
    ])
    mockEdgesByTodo.mockReturnValueOnce(new Map([['t1', ['s1', 's2']]]))
    mockGetCache.mockReturnValue([
      { sessionId: 's1', cli: 'claude', cwd: '/x', title: '修复任务菜单标题生成', updatedAt: 100, deleted: false, copies: [] },
      { sessionId: 's2', cli: 'codex', cwd: '/x', title: '保留双击手动编辑', updatedAt: 90, deleted: false, copies: [] },
    ])
    const port = await listen()

    const res = await fetch(`http://localhost:${port}/api/todos/t1/title`, { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: '智能任务标题' })
    const input = String(mockGenerateTaskTitle.mock.calls[0][0])
    expect(input).toContain('Current title: 原始任务标题')
    expect(input).toContain('Progress summary: 已有进展')
    expect(input).toContain('修复任务菜单标题生成')
    expect(input).toContain('保留双击手动编辑')
    expect(mockUpdateTask).toHaveBeenCalledWith(expect.anything(), 't1', { title: '智能任务标题' })
  })

  it('returns 404 for an unknown task', async () => {
    mockListTasks.mockReturnValue([])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/missing/title`, { method: 'POST' })
    expect(res.status).toBe(404)
    expect(mockGenerateTaskTitle).not.toHaveBeenCalled()
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

// ── PATCH /api/todos/:id ddl + GET /api/todos ddl ─────────────────────────────
describe('task ddl via /api/todos', () => {
  it('GET /todos includes ddl from allTaskDdls (null when unset)', async () => {
    const port = await listen()
    const base = `http://localhost:${port}/api`
    mockListTasks.mockReturnValueOnce([
      { id: 'task_X', title: 'X', status: '待办', priority: 'P1', project: null, detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false },
      { id: 'task_Y', title: 'Y', status: '待办', priority: 'P1', project: null, detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false },
    ])
    mockTaskDdls.clear(); mockTaskDdls.set('task_X', '2026-06-16')
    const body = await (await fetch(`${base}/todos`)).json() as any
    expect(body.todos.find((t: any) => t.id === 'task_X').ddl).toBe('2026-06-16')
    expect(body.todos.find((t: any) => t.id === 'task_Y').ddl).toBeNull()
  })

  it('PATCH /todos/:id sets ddl', async () => {
    mockSetTaskDdl.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/task_X`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ddl: '2026-06-20' }),
    })
    expect(res.status).toBe(200)
    expect(mockSetTaskDdl).toHaveBeenCalledWith('task_X', '2026-06-20')
  })

  it('PATCH /todos/:id clears ddl with null', async () => {
    mockSetTaskDdl.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/task_X`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ddl: null }),
    })
    expect(res.status).toBe(200)
    expect(mockSetTaskDdl).toHaveBeenCalledWith('task_X', null)
  })

  it('PATCH /todos/:id rejects malformed ddl with 400', async () => {
    mockSetTaskDdl.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/task_X`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ddl: 'next week' }),
    })
    expect(res.status).toBe(400)
    expect(mockSetTaskDdl).not.toHaveBeenCalled()
  })

  it('PATCH /todos/:id without ddl key does not touch ddl', async () => {
    mockSetTaskDdl.mockClear()
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/task_X`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: '进行中' }),
    })
    expect(res.status).toBe(200)
    expect(mockSetTaskDdl).not.toHaveBeenCalled()
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

// ── POST /api/todos/from-session: validation branches ────────────────────────
describe('POST /api/todos/from-session', () => {
  it('400 when sessionId missing', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/from-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'P' }),
    })
    expect(res.status).toBe(400)
  })

  it('404 when the session is unknown', async () => {
    mockGetCache.mockReturnValue([])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/from-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('404 when the session exists but has no readable transcript', async () => {
    mockGetCache.mockReturnValue([
      { sessionId: 'sess-1', cli: 'claude', cwd: '/x', title: 't', updatedAt: 100, deleted: false, copies: [], contentSourcePath: null },
    ])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/from-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('422 when the extracted digest is empty', async () => {
    mockGetCache.mockReturnValue([
      { sessionId: 'sess-1', cli: 'claude', cwd: '/x', title: 't', updatedAt: 100, deleted: false, copies: [], contentSourcePath: '/x.jsonl' },
    ])
    mockExtractConversation.mockReturnValueOnce('   ')
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/todos/from-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'empty session content' })
  })
})

// ── T9: POST /api/context ─────────────────────────────────────────────────────
describe('POST /api/context', () => {
  it('ensures a project context file', async () => {
    mockEnsureContextDoc.mockReturnValueOnce({ ref: 'projects/Berth/index.md', abs: '/tmp/docs/projects/Berth/index.md', created: true })
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'project', key: 'Berth', title: 'Berth' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ref).toBe('projects/Berth/index.md')
    expect(typeof body.created).toBe('boolean')
  })

  it('returns 400 when kind is invalid', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'unknown', key: 'Berth' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when key is missing', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'project' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/sessions/:id/consolidate ───────────────────────────────────────
describe('POST /api/sessions/:id/consolidate', () => {
  it('consolidates a known session (200)', async () => {
    mockRunConsolidation.mockResolvedValueOnce({ ok: true, changed: ['进展日志'], added: [], removed: [], commit: 'abc1234', rotated: false })
    mockGetCache.mockReturnValue([
      { sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [], contentSourcePath: '/tmp/session.jsonl' },
    ])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/sessions/s1/consolidate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.changed).toEqual(['进展日志'])
    expect(body.added).toEqual([])
    expect(body.removed).toEqual([])
    expect(body.commit).toBe('abc1234')
    expect(body.rotated).toBe(false)
  })

  it('returns 404 for an unknown session', async () => {
    mockGetCache.mockReturnValue([])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/sessions/nope-not-real/consolidate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body.error).toBeTruthy()
  })

  it('returns 409 when runConsolidation returns ok:false', async () => {
    mockRunConsolidation.mockResolvedValueOnce({ ok: false, reason: 'session not linked to a task or project' })
    mockGetCache.mockReturnValue([
      { sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [], contentSourcePath: null },
    ])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/sessions/s1/consolidate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as any
    expect(body.error).toBeTruthy()
  })

  it('maps an InternalAgentBlocked (auth) to 409 {blocked,cli,hint}', async () => {
    mockRunConsolidation.mockRejectedValueOnce(new InternalAgentBlocked('auth', 'codex', 'not logged in'))
    mockGetCache.mockReturnValue([
      { sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [], contentSourcePath: '/tmp/session.jsonl' },
    ])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/sessions/s1/consolidate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as any
    expect(body.blocked).toBe('auth')
    expect(body.cli).toBe('codex')
    expect(body.hint).toContain('codex login')
    expect(body.contextAgentCwd).toMatch(/\.berth\/agent-cwd$/)
  })
})

// ── POST /api/context/update ─────────────────────────────────────────────────
describe('POST /api/context/update', () => {
  it('runs an agent-driven update for a task (200)', async () => {
    mockListTasks.mockReturnValue([{ id: 't1', title: 'My Task', project: 'Berth' }])
    mockRunContextUpdate.mockResolvedValueOnce({ ok: true, changed: ['项目背景'], added: ['新事实'], removed: [], commit: 'def4567', rotated: true })
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'task', key: 't1', userInput: 'remember this' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.ref).toBe('tasks/t1/index.md')
    expect(body.changed).toEqual(['项目背景'])
    expect(body.added).toEqual(['新事实'])
    expect(body.commit).toBe('def4567')
    expect(body.rotated).toBe(true)
    // userInput was forwarded; no sessionId means no transcript read.
    expect(mockRunContextUpdate.mock.calls[0][0]).toMatchObject({ userInput: 'remember this' })
    expect(mockReadTranscript).not.toHaveBeenCalled()
  })

  it('saves pasted images beside the context doc and forwards markdown refs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'berth-api-'))
    tmpRoots.push(root)
    mockSettings.set('docsRoot', root)
    const port = await listen()
    const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64')
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'project', key: 'Berth', images: [png] }),
    })
    expect(res.status).toBe(200)
    const assetNames = readdirSync(join(root, 'projects', 'Berth', 'assets'))
    expect(assetNames).toHaveLength(1)
    expect(mockRunContextUpdate.mock.calls[0][0].userInput).toMatch(/^Pasted images:\n!\[\]\(assets\/context-/)
  })

  it('reads the session transcript when sessionId is supplied', async () => {
    mockGetCache.mockReturnValue([
      { sessionId: 's1', cli: 'claude', cwd: '/x', title: 'old', updatedAt: 100, deleted: false, copies: [], contentSourcePath: '/tmp/session.jsonl' },
    ])
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'project', key: 'Berth', sessionId: 's1' }),
    })
    expect(res.status).toBe(200)
    expect(mockReadTranscript).toHaveBeenCalledWith('/tmp/session.jsonl')
    expect(mockRunContextUpdate.mock.calls[0][0]).toMatchObject({ transcript: 'transcript text' })
  })

  it('rejects an invalid kind (400)', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'nope', key: 't1', userInput: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(mockRunContextUpdate).not.toHaveBeenCalled()
  })

  it('rejects when neither userInput nor sessionId is given (400)', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'task', key: 't1' }),
    })
    expect(res.status).toBe(400)
    expect(mockRunContextUpdate).not.toHaveBeenCalled()
  })

  it('returns 409 when the service reports ok:false', async () => {
    mockRunContextUpdate.mockResolvedValueOnce({ ok: false, reason: 'agent produced no usable update' })
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/context/update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'task', key: 't1', userInput: 'x' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as any
    expect(body.error).toBe('agent produced no usable update')
    expect(body.contextAgentCwd).toMatch(/\.berth\/agent-cwd$/)
  })
})

// ── POST /api/doc/revert ─────────────────────────────────────────────────────
describe('POST /api/doc/revert', () => {
  it('reverts a valid commit (200)', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/doc/revert`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit: 'abc1234' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)
    expect(mockRevertCommit).toHaveBeenCalledWith(expect.any(String), 'abc1234')
  })

  it('rejects a malformed commit sha (400)', async () => {
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/doc/revert`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit: 'not a sha' }),
    })
    expect(res.status).toBe(400)
    expect(mockRevertCommit).not.toHaveBeenCalled()
  })

  it('returns 409 when the revert fails', async () => {
    mockRevertCommit.mockReturnValueOnce({ ok: false, reason: 'invalid commit' } as any)
    const port = await listen()
    const res = await fetch(`http://localhost:${port}/api/doc/revert`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit: 'abc1234' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json() as any).error).toBe('invalid commit')
  })
})

describe('open-local API', () => {
  beforeEach(() => { mockExecFile.mockReset() })

  // local header const (avoid shadowing the module-level `J`): JSON + loopback Origin.
  const HDR = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:7777' }

  it('opens a file target via the platform command and returns ok', async () => {
    // file existence is checked for kind:'file' — use a path we know exists: this test file's dir.
    const existing = process.cwd()
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: any, cb: Function) => cb(null, '', ''))
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: existing }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [bin, args] = mockExecFile.mock.calls[0]
    if (process.platform === 'darwin') { expect(bin).toBe('open'); expect(args).toEqual([existing]) }
  })

  it('passes a custom scheme through without an existence check', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: any, cb: Function) => cb(null, '', ''))
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: 'obsidian://open?file=x' }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    const [, args] = mockExecFile.mock.calls[0]
    expect(args).toContain('obsidian://open?file=x')
  })

  it('rejects a missing target with 400', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects a foreign origin with 403', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ target: process.cwd() }),
    })
    expect(r.status).toBe(403)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON content-type with 415', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'http://127.0.0.1:7777' },
      body: 'target=/etc/hosts',
    })
    expect(r.status).toBe(415)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent file target', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: '/no/such/path/xyz-123.md' }),
    })
    expect(r.status).toBe(404)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
