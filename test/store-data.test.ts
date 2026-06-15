import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import type { Task } from '../src/data/types'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'hello', status: '待办', priority: 'P1', projectId: null, project: 'projA',
    detailDoc: null, progress: null, updatedAt: 100, syncedAt: 0, deleted: false, ...over,
  }
}

describe('store data layer', () => {
  it('inserts and reads back a task with types preserved', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask())
    const t = db.getTask('t1')!
    expect(t.projectId).toBeTruthy()
    expect(t.project).toBe('projA')
    expect({ ...t, projectId: null }).toEqual(mkTask())
    expect(typeof t.updatedAt).toBe('number')
    expect(t.deleted).toBe(false)
  })

  it('allTasks excludes deleted by default and includes when asked', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask({ id: 'a' }))
    db.insertTask(mkTask({ id: 'b' }))
    db.softDeleteTask('b', 200)
    expect(db.allTasks().map(t => t.id)).toEqual(['a'])
    expect(db.allTasks(true).map(t => t.id).sort()).toEqual(['a', 'b'])
    expect(db.getTask('b')!.deleted).toBe(true)
  })

  it('updateTaskFields patches only given fields and bumps updated_at', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask())
    db.updateTaskFields('t1', { status: '进行中' }, 555)
    const t = db.getTask('t1')!
    expect(t.status).toBe('进行中')
    expect(t.title).toBe('hello')        // untouched
    expect(t.updatedAt).toBe(555)
  })

  it('setTaskSynced records sync time without touching updated_at', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask())
    db.setTaskSynced('t1', 999)
    const t = db.getTask('t1')!
    expect(t.syncedAt).toBe(999)
    expect(t.updatedAt).toBe(100)
  })

  it('projects upsert + list', () => {
    const db = openStore(':memory:')
    db.upsertProject({ name: 'projA', hue: 'Blue' })
    db.upsertProject({ name: 'projA', hue: 'Red' })   // update
    db.upsertProject({ name: 'projB' })
    const ps = db.allProjects()
    expect(ps.every(p => p.id)).toBe(true)
    expect(ps.find(p => p.name === 'projA')!.hue).toBe('Red')
    expect(ps.map(p => p.name).sort()).toEqual(['projA', 'projB'])
  })

  it('external_ref put / getByExternal / delete roundtrip', () => {
    const db = openStore(':memory:')
    db.putRef({ entityKind: 'task', entityId: 't1', sourceId: 'feishu-main', externalId: 'recX', externalHash: 'h1', externalUpdatedAt: 7 })
    expect(db.getRef('task', 't1', 'feishu-main')!.externalId).toBe('recX')
    expect(db.getRefByExternal('feishu-main', 'task', 'recX')!.entityId).toBe('t1')
    db.putRef({ entityKind: 'task', entityId: 't1', sourceId: 'feishu-main', externalId: 'recX', externalHash: 'h2', externalUpdatedAt: 9 })
    expect(db.getRef('task', 't1', 'feishu-main')!.externalHash).toBe('h2')   // upsert
    db.deleteRef('task', 't1', 'feishu-main')
    expect(db.getRef('task', 't1', 'feishu-main')).toBeNull()
  })

  it('data_source upsert + list with config JSON roundtrip', () => {
    const db = openStore(':memory:')
    db.upsertDataSource({ id: 'feishu-main', kind: 'feishu-bitable', label: 'Main', config: { baseToken: 'b', fieldMap: { title: '标题' } }, pullMode: 'manual', pushMode: 'auto', enabled: true })
    const rows = db.allDataSources()
    expect(rows).toHaveLength(1)
    expect(rows[0].config.fieldMap.title).toBe('标题')
    expect(rows[0].pushMode).toBe('auto')
    expect(rows[0].enabled).toBe(true)
    db.deleteDataSource('feishu-main')
    expect(db.allDataSources()).toHaveLength(0)
  })

  it('app_setting get/set', () => {
    const db = openStore(':memory:')
    expect(db.getSetting('docsRoot')).toBeNull()
    db.setSetting('docsRoot', '/x/y')
    expect(db.getSetting('docsRoot')).toBe('/x/y')
    db.setSetting('docsRoot', '/z')
    expect(db.getSetting('docsRoot')).toBe('/z')
  })

  it('task ddl set / clear / allTaskDdls roundtrip', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask({ id: 'a' }))
    db.insertTask(mkTask({ id: 'b' }))
    expect(db.allTaskDdls().size).toBe(0)
    db.setTaskDdl('a', '2026-06-16')
    db.setTaskDdl('b', '2026-06-20')
    expect(db.allTaskDdls().get('a')).toBe('2026-06-16')
    db.setTaskDdl('a', '2026-06-18')   // overwrite
    expect(db.allTaskDdls().get('a')).toBe('2026-06-18')
    db.setTaskDdl('a', null)           // clear
    expect(db.allTaskDdls().has('a')).toBe(false)
    expect(db.allTaskDdls().get('b')).toBe('2026-06-20')
  })

  it('setTaskDdl rejects malformed dates', () => {
    const db = openStore(':memory:')
    db.insertTask(mkTask({ id: 'a' }))
    expect(() => db.setTaskDdl('a', '2026-6-1')).toThrow()
    expect(() => db.setTaskDdl('a', 'tomorrow')).toThrow()
    expect(() => db.setTaskDdl('a', '')).not.toThrow()   // empty clears, like null
    expect(db.allTaskDdls().has('a')).toBe(false)
  })

  it('conflict add / open / resolve', () => {
    const db = openStore(':memory:')
    db.addConflict({ id: 'c1', entityKind: 'task', entityId: 't1', sourceId: 'feishu-main', berth: { title: 'B' }, external: { title: 'E' }, detectedAt: 10, resolved: false })
    const open = db.openConflicts()
    expect(open).toHaveLength(1)
    expect(open[0].berth.title).toBe('B')
    db.resolveConflict('c1')
    expect(db.openConflicts()).toHaveLength(0)
    expect(db.getConflict('c1')!.resolved).toBe(true)
  })
})
