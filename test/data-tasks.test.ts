import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/agent/triage', () => ({ classifyProject: vi.fn() }))

import { openStore } from '../src/db/store'
import { listTasks, createTask, updateTask, deleteTask } from '../src/data/tasks'
import { createProject } from '../src/data/projects'
import { classifyProject } from '../src/agent/triage'

// Minimal fake DocStore for the image path.
function fakeDocStore() {
  const writes: { abs: string; content: string }[] = []
  return {
    store: {
      saveAttachment: (_d: string, _h: string) => ({ rel: 'assets/x.png', abs: '/root/assets/x.png' }),
      taskDocRef: (id: string) => `tasks/${id}/index.md`,
      resolveDocPath: (ref: string) => `/root/${ref}`,
      writeDoc: (abs: string, content: string) => { writes.push({ abs, content }); return { mtime: 1 } },
    } as any,
    writes,
  }
}

let nowVal = 1000
const now = () => nowVal

describe('data/tasks', () => {
  beforeEach(() => { (classifyProject as any).mockReset(); nowVal = 1000 })

  it('creates a task with a uuid id + defaults when one high-confidence project matches', async () => {
    const store = openStore(':memory:')
    createProject(store, 'Berth', 'Blue')
    ;(classifyProject as any).mockResolvedValue({ candidates: [{ name: 'Berth', confidence: 0.9 }], needNewProject: false })
    const r = await createTask(store, fakeDocStore().store, '给 Berth 加能力', {}, now)
    expect(r.status).toBe('created')
    if (r.status === 'created') {
      expect(r.record.id).toMatch(/[0-9a-f-]{36}/)
      expect(r.record.project).toBe('Berth')
    }
    const all = listTasks(store)
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe('待办')
    expect(all[0].priority).toBe('P1')
    expect(all[0].updatedAt).toBe(1000)
  })

  it('returns duplicate when a same-title task exists', async () => {
    const store = openStore(':memory:')
    ;(classifyProject as any).mockResolvedValue({ candidates: [], needNewProject: true })
    await createTask(store, fakeDocStore().store, '已存在的任务', { confirm: true }, now)
    const r = await createTask(store, fakeDocStore().store, '已存在的任务', {}, now)
    expect(r.status).toBe('duplicate')
    if (r.status === 'duplicate') expect(r.existing.title).toBe('已存在的任务')
  })

  it('returns needs-confirm when classification is ambiguous', async () => {
    const store = openStore(':memory:')
    createProject(store, 'Berth'); createProject(store, 'meego')
    ;(classifyProject as any).mockResolvedValue({ candidates: [{ name: 'Berth', confidence: 0.5 }, { name: 'meego', confidence: 0.45 }], needNewProject: false })
    const r = await createTask(store, fakeDocStore().store, '改点东西', {}, now)
    expect(r.status).toBe('needs-confirm')
  })

  it('never writes an unlisted project unless createOption=true', async () => {
    const store = openStore(':memory:')
    const r1 = await createTask(store, fakeDocStore().store, 'x', { projectId: '全新X', confirm: true, createOption: false }, now)
    expect(r1.status).toBe('needs-confirm')
    const r2 = await createTask(store, fakeDocStore().store, 'y', { projectId: '全新X', confirm: true, createOption: true }, now)
    expect(r2.status).toBe('created')
    if (r2.status === 'created') expect(r2.record.project).toBe('全新X')
    expect(store.allProjects().map(p => p.name)).toContain('全新X')
  })

  it('pasted images write a detail doc and set detail_doc', async () => {
    const store = openStore(':memory:')
    const ds = fakeDocStore()
    const r = await createTask(store, ds.store, '带图任务', { confirm: true, images: ['data:image/png;base64,xx'] }, now)
    expect(r.status).toBe('created')
    if (r.status === 'created') expect(r.record.detailDoc).toMatch(/tasks\/.*\/index\.md/)
    expect(ds.writes).toHaveLength(1)
    expect(ds.writes[0].content).toContain('![](assets/x.png)')
    expect(listTasks(store)[0].detailDoc).toMatch(/tasks\/.*\/index\.md/)
  })

  it('updateTask validates enums and bumps updated_at', async () => {
    const store = openStore(':memory:')
    ;(classifyProject as any).mockResolvedValue({ candidates: [], needNewProject: true })
    const created = await createTask(store, fakeDocStore().store, '任务', { confirm: true }, now)
    const id = (created as any).record.id
    nowVal = 2000
    updateTask(store, id, { status: '进行中' }, now)
    expect(store.getTask(id)!.status).toBe('进行中')
    expect(store.getTask(id)!.updatedAt).toBe(2000)
    expect(() => updateTask(store, id, { priority: 'P9' }, now)).toThrow(/invalid priority/)
    expect(() => updateTask(store, id, {}, now)).toThrow(/no editable/)
  })

  it('uses the configured vocabularies for create-defaults and update-validation', async () => {
    const { setTaskFieldConfig } = await import('../src/data/task-config')
    const store = openStore(':memory:')
    setTaskFieldConfig(store, { statuses: ['新建', '处理中', '完成'], priorities: ['高', '低'] })
    ;(classifyProject as any).mockResolvedValue({ candidates: [], needNewProject: true })
    const created = await createTask(store, fakeDocStore().store, '配置任务', { confirm: true }, now)
    const id = (created as any).record.id
    // default status = first item; default priority = first (P1 not in this custom list)
    expect(store.getTask(id)!.status).toBe('新建')
    expect(store.getTask(id)!.priority).toBe('高')
    // update validates against the configured lists
    updateTask(store, id, { status: '处理中', priority: '低' }, now)
    expect(store.getTask(id)!.status).toBe('处理中')
    expect(() => updateTask(store, id, { status: '进行中' }, now)).toThrow(/invalid status/)
    expect(() => updateTask(store, id, { priority: 'P0' }, now)).toThrow(/invalid priority/)
  })

  it('deleteTask soft-deletes', async () => {
    const store = openStore(':memory:')
    ;(classifyProject as any).mockResolvedValue({ candidates: [], needNewProject: true })
    const created = await createTask(store, fakeDocStore().store, '删我', { confirm: true }, now)
    const id = (created as any).record.id
    deleteTask(store, id, now)
    expect(listTasks(store)).toHaveLength(0)
    expect(store.getTask(id)!.deleted).toBe(true)
  })

  it('throws on empty text', async () => {
    const store = openStore(':memory:')
    await expect(createTask(store, fakeDocStore().store, '   ', {}, now)).rejects.toThrow()
  })
})
