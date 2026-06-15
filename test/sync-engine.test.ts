import { describe, it, expect, beforeEach } from 'vitest'
import { openStore } from '../src/db/store'
import { syncSource, resolveConflict } from '../src/data/sync/engine'
import { hashFields, fieldsOf } from '../src/data/sync/hash'
import type { DataSourceAdapter } from '../src/data/sync/adapter'
import type { DataSourceRow, NormalizedRecord, TaskFields } from '../src/data/types'

const src: DataSourceRow = { id: 'feishu-main', kind: 'feishu-bitable', label: null, config: {}, pullMode: 'manual', pushMode: 'manual', enabled: true }
const ctx = { docsRoot: '/root' }

function fields(over: Partial<TaskFields> = {}): TaskFields {
  return { title: 'T', status: '待办', priority: 'P1', project: null, detailDoc: null, progress: null, ...over }
}
function rec(externalId: string, f: TaskFields): NormalizedRecord {
  return { externalId, fields: f, hash: hashFields(f) }
}

/** Fake adapter backed by an in-memory record list; spies on writes. */
function fakeAdapter(initial: NormalizedRecord[] = []) {
  const calls = { create: [] as any[], update: [] as any[], del: [] as string[] }
  let seq = 0
  const adapter: DataSourceAdapter = {
    kind: 'feishu-bitable',
    async pullTasks() { return initial },
    async createTask(_s, task) { calls.create.push(task); const id = `ext_${seq++}`; return id },
    async updateTask(_s, externalId, patch) { calls.update.push({ externalId, patch }) },
    async deleteTask(_s, externalId) { calls.del.push(externalId) },
  }
  return { adapter, calls }
}

let nowVal = 1000
const now = () => nowVal

describe('sync engine', () => {
  beforeEach(() => { nowVal = 1000 })

  it('pulls a brand-new external record into a new task + ref', async () => {
    const store = openStore(':memory:')
    const { adapter } = fakeAdapter([rec('extA', fields({ title: '外部任务' }))])
    const r = await syncSource(store, src, ctx, { push: false, now }, adapter)
    expect(r.pulled).toBe(1)
    const tasks = store.allTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('外部任务')
    expect(store.getRefByExternal('feishu-main', 'task', 'extA')!.entityId).toBe(tasks[0].id)
  })

  it('applies an external-only change without a conflict', async () => {
    const store = openStore(':memory:')
    const f0 = fields({ title: 'v1' })
    let recs = [rec('extA', f0)]
    const { adapter } = fakeAdapter(recs)
    await syncSource(store, src, ctx, { push: false, now }, adapter)
    const id = store.allTasks()[0].id
    // external changes; berth untouched (synced)
    const f1 = fields({ title: 'v2' })
    recs[0] = rec('extA', f1)
    nowVal = 2000
    const r = await syncSource(store, src, ctx, { push: false, now }, adapter)
    expect(store.getTask(id)!.title).toBe('v2')
    expect(r.conflicts).toHaveLength(0)
    expect(r.pulled).toBe(1)
  })

  it('records a conflict when both sides changed, applying nothing', async () => {
    const store = openStore(':memory:')
    const f0 = fields({ title: 'v1' })
    const recs = [rec('extA', f0)]
    const { adapter, calls } = fakeAdapter(recs)
    await syncSource(store, src, ctx, { push: false, now }, adapter)
    const id = store.allTasks()[0].id
    // berth edits locally
    nowVal = 1500
    store.updateTaskFields(id, { title: 'berth-edit' }, nowVal)
    // external also changed
    recs[0] = rec('extA', fields({ title: 'ext-edit' }))
    nowVal = 2000
    const r = await syncSource(store, src, ctx, { now }, adapter)
    expect(r.conflicts).toHaveLength(1)
    expect(store.getTask(id)!.title).toBe('berth-edit')   // unchanged
    expect(calls.update).toHaveLength(0)                   // not pushed
    expect(r.conflicts[0].berth.title).toBe('berth-edit')
    expect(r.conflicts[0].external.title).toBe('ext-edit')
  })

  it('pushes a berth-only change via updateTask', async () => {
    const store = openStore(':memory:')
    const recs = [rec('extA', fields({ title: 'v1' }))]
    const { adapter, calls } = fakeAdapter(recs)
    await syncSource(store, src, ctx, { push: false, now }, adapter)
    const id = store.allTasks()[0].id
    nowVal = 2000
    store.updateTaskFields(id, { title: 'v2' }, nowVal)
    const r = await syncSource(store, src, ctx, { pull: false, now }, adapter)
    expect(r.pushed).toBe(1)
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0].patch.title).toBe('v2')
    expect(store.getTask(id)!.syncedAt).toBe(2000)
  })

  it('creates an external record for a berth task with no ref', async () => {
    const store = openStore(':memory:')
    const { adapter, calls } = fakeAdapter([])
    nowVal = 3000
    store.insertTask({ id: 'u1', ...fields({ title: 'local' }), projectId: null, updatedAt: 3000, syncedAt: 0, deleted: false })
    const r = await syncSource(store, src, ctx, { pull: false, now }, adapter)
    expect(r.pushed).toBe(1)
    expect(calls.create).toHaveLength(1)
    expect(store.getRef('task', 'u1', 'feishu-main')!.externalId).toBe('ext_0')
  })

  it('deletes the external record for a soft-deleted task', async () => {
    const store = openStore(':memory:')
    const { adapter, calls } = fakeAdapter([rec('extA', fields())])
    await syncSource(store, src, ctx, { push: false, now }, adapter)
    const id = store.allTasks()[0].id
    nowVal = 4000
    store.softDeleteTask(id, 4000)
    const r = await syncSource(store, src, ctx, { pull: false, now }, adapter)
    expect(calls.del).toEqual(['extA'])
    expect(store.getRef('task', id, 'feishu-main')).toBeNull()
    expect(r.pushed).toBe(1)
  })

  it('resolveConflict(external) applies the external side; (berth) pushes berth', async () => {
    const store = openStore(':memory:')
    const recs = [rec('extA', fields({ title: 'v1' }))]
    const { adapter, calls } = fakeAdapter(recs)
    store.upsertDataSource(src)
    await syncSource(store, src, ctx, { push: false, now }, adapter)
    const id = store.allTasks()[0].id
    nowVal = 1500; store.updateTaskFields(id, { title: 'berth-edit' }, 1500)
    recs[0] = rec('extA', fields({ title: 'ext-edit' }))
    nowVal = 2000
    const r = await syncSource(store, src, ctx, { now }, adapter)
    const cid = r.conflicts[0].id

    nowVal = 2500
    await resolveConflict(store, cid, 'external', ctx, () => adapter, now)
    expect(store.getTask(id)!.title).toBe('ext-edit')
    expect(store.openConflicts()).toHaveLength(0)

    // a fresh conflict, resolved toward berth → pushes
    nowVal = 3000; store.updateTaskFields(id, { title: 'berth2' }, 3000)
    recs[0] = rec('extA', fields({ title: 'ext2' }))
    nowVal = 3500
    const r2 = await syncSource(store, src, ctx, { now }, adapter)
    const cid2 = r2.conflicts[0].id
    await resolveConflict(store, cid2, 'berth', ctx, () => adapter, now)
    expect(calls.update.some(u => u.patch.title === 'berth2')).toBe(true)
    expect(store.openConflicts()).toHaveLength(0)
  })
})
