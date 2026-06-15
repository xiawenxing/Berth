import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { listProjects, createProject } from '../src/data/projects'

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
})
