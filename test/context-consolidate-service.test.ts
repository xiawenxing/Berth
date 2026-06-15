import { describe, it, expect } from 'vitest'
import { resolveSessionContextTarget } from '../src/server/context-consolidate-service'

describe('resolveSessionContextTarget', () => {
  const docStore: any = { taskDocRef: (id: string) => `tasks/${id}/index.md`, projectDocRef: (n: string) => `projects/${n}/index.md`, resolveDocPath: (r: string) => '/root/' + r }
  it('maps a task-linked session to its task context', () => {
    const t = resolveSessionContextTarget({ sessionId: 's', todoKey: 'u1', projectId: null } as any, { title: 'T', project: 'P' } as any, docStore)
    expect(t).toEqual({ kind: 'task', key: 'u1', title: 'T', projectName: 'P', ref: 'tasks/u1/index.md', abs: '/root/tasks/u1/index.md' })
  })
  it('maps a project-only session to its project context', () => {
    const t = resolveSessionContextTarget({ sessionId: 's', todoKey: null, projectId: 'Berth' } as any, null, docStore)
    expect(t).toEqual({ kind: 'project', key: 'Berth', title: 'Berth', projectName: 'Berth', ref: 'projects/Berth/index.md', abs: '/root/projects/Berth/index.md' })
  })
  it('returns null when the session is linked to neither', () => {
    expect(resolveSessionContextTarget({ sessionId: 's', todoKey: null, projectId: null } as any, null, docStore)).toBeNull()
  })
})
