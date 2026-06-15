import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { ensureBootstrap } from '../src/data/bootstrap'
import { migrateIdentitiesOnce } from '../src/data/migrate'
import { hashFields } from '../src/data/sync/hash'
import type { DataSourceAdapter } from '../src/data/sync/adapter'
import type { DataSourceRow, NormalizedRecord, TaskFields } from '../src/data/types'

const ctx = { docsRoot: '/root' }
function fields(over: Partial<TaskFields> = {}): TaskFields {
  return { title: 'T', status: '待办', priority: 'P1', project: null, detailDoc: null, progress: null, ...over }
}
function rec(externalId: string, f: TaskFields): NormalizedRecord { return { externalId, fields: f, hash: hashFields(f) } }

function fakeAdapter(records: NormalizedRecord[]): DataSourceAdapter {
  return {
    kind: 'feishu-bitable',
    async pullTasks() { return records },
    async createTask() { return 'x' },
    async updateTask() {},
    async deleteTask() {},
    async pullProjects() { return [{ name: 'Berth', hue: 'Blue' }] },
  }
}

const feishuSrc: DataSourceRow = { id: 'feishu-main', kind: 'feishu-bitable', label: 'Main', config: {}, pullMode: 'manual', pushMode: 'manual', enabled: true }

describe('ensureBootstrap', () => {
  it('seeds docsRoot + data sources from a local seed, idempotently', () => {
    const store = openStore(':memory:')
    ensureBootstrap(store, { docsRoot: '/vault', dataSources: [feishuSrc] })
    expect(store.getSetting('docsRoot')).toBe('/vault')
    expect(store.allDataSources()).toHaveLength(1)
    // second call is a no-op (does not duplicate)
    ensureBootstrap(store, { docsRoot: '/other', dataSources: [] })
    expect(store.getSetting('docsRoot')).toBe('/vault')
    expect(store.allDataSources()).toHaveLength(1)
  })

  it('no seed → nothing configured but marked bootstrapped', () => {
    const store = openStore(':memory:')
    ensureBootstrap(store, null)
    expect(store.allDataSources()).toHaveLength(0)
    expect(store.getSetting('docsRoot')).toBeNull()
    expect(store.getSetting('bootstrapped')).toBe('1')
  })
})

describe('migrateIdentitiesOnce', () => {
  it('mints tasks, writes refs, and rewrites edge/intent keys recordId → uuid', async () => {
    const store = openStore(':memory:')
    store.upsertDataSource(feishuSrc)
    // pre-existing edges + a launch_intent keyed by recordIds (the old world)
    store.addEdge('rec_A', 'sessA')
    store.addEdge('rec_B', 'sessB')
    store.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/c', projectId: null, todoKey: 'rec_A', sessionId: null, createdAt: 1, bound: false })

    const adapter = fakeAdapter([rec('rec_A', fields({ title: '任务A' })), rec('rec_B', fields({ title: '任务B' }))])
    await migrateIdentitiesOnce(store, ctx, () => adapter, () => 1000)

    expect(store.allTasks()).toHaveLength(2)
    const idA = store.getRefByExternal('feishu-main', 'task', 'rec_A')!.entityId
    const idB = store.getRefByExternal('feishu-main', 'task', 'rec_B')!.entityId

    const edges = store.edgesByTodo()
    expect(edges.get(idA)).toEqual(['sessA'])
    expect(edges.get(idB)).toEqual(['sessB'])
    expect(edges.has('rec_A')).toBe(false)

    expect(store.pendingIntents()[0].todoKey).toBe(idA)
    expect(store.getSetting('migrated')).toBe('1')
    expect(store.allProjects().map(p => p.name)).toContain('Berth')
  })

  it('is a no-op on a fresh install with no feishu source', async () => {
    const store = openStore(':memory:')
    await migrateIdentitiesOnce(store, ctx, () => fakeAdapter([]), () => 1)
    expect(store.allTasks()).toHaveLength(0)
    expect(store.getSetting('migrated')).toBe('1')
  })

  it('does not run twice', async () => {
    const store = openStore(':memory:')
    store.upsertDataSource(feishuSrc)
    let pulls = 0
    const adapter: DataSourceAdapter = { ...fakeAdapter([rec('rec_A', fields())]), async pullTasks() { pulls++; return [rec('rec_A', fields())] } }
    await migrateIdentitiesOnce(store, ctx, () => adapter, () => 1)
    await migrateIdentitiesOnce(store, ctx, () => adapter, () => 1)
    expect(pulls).toBe(1)
  })
})
