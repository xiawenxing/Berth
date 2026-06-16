import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { listProjects, createProject, updateProject, deleteProject } from '../src/data/projects'

describe('data/projects', () => {
  it('creates and lists projects', () => {
    const store = openStore(':memory:')
    createProject(store, 'Berth', 'Blue')
    createProject(store, 'meego')
    expect(listProjects(store).map(p => p.name).sort()).toEqual(['Berth', 'meego'])
    expect(listProjects(store).find(p => p.name === 'Berth')!.hue).toBe('Blue')
  })

  it('trims and rejects empty names', () => {
    const store = openStore(':memory:')
    expect(createProject(store, '  X  ').name).toBe('X')
    expect(() => createProject(store, '   ')).toThrow(/empty/)
  })

  it('renames a project without breaking task links', () => {
    const store = openStore(':memory:')
    const p = createProject(store, 'Old')
    store.insertTask({
      id: 't1', title: 'Task', status: '待办', priority: 'P1', projectId: p.id, project: null,
      detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false,
    })

    updateProject(store, p.id, { name: 'New' }, () => 200)

    expect(listProjects(store).map(x => x.name)).toEqual(['New'])
    expect(store.getTask('t1')!.projectId).toBe(p.id)
    expect(store.getTask('t1')!.project).toBe('New')
    expect(store.getTask('t1')!.updatedAt).toBe(200)
  })

  it('deletes a project and clears task/session references', () => {
    const store = openStore(':memory:')
    const p = createProject(store, 'Gone')
    store.insertTask({
      id: 't1', title: 'Task', status: '待办', priority: 'P1', projectId: p.id, project: null,
      detailDoc: null, progress: null, updatedAt: 1, syncedAt: 1, deleted: false,
    })
    store.setAttach('s1', p.id, 'confirmed')
    store.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/x', projectId: p.id, todoKey: null, sessionId: null, createdAt: 1, bound: false })
    store.addProjectPath(p.id, '/x', true)
    store.setArchived(p.id, true)

    deleteProject(store, p.id, () => 300)

    expect(listProjects(store)).toEqual([])
    expect(store.getTask('t1')!.projectId).toBeNull()
    expect(store.getTask('t1')!.project).toBeNull()
    expect(store.getTask('t1')!.updatedAt).toBe(300)
    expect(store.getAttach('s1')).toEqual({ projectId: null, state: 'confirmed' })
    expect(store.allProjectPaths().has(p.id)).toBe(false)
    expect(store.allArchivedSet().has(p.id)).toBe(false)
  })
})
