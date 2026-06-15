import { describe, it, expect } from 'vitest'
import { enrichManifestForContext } from '../src/server/pty-ws'
import type { ManifestInput } from '../src/agent/manifest'

describe('enrichManifestForContext', () => {
  it('merges context paths + rules into a task manifest input', () => {
    const base: ManifestInput = {
      kind: 'task', projectName: 'Berth', docsRoot: '/d',
      todo: { id: 'u1', title: 'T', status: 's', priority: 'P1', projectId: 'p', project: 'Berth',
              detailDoc: null, progress: null, updatedAt: 1, syncedAt: 0, deleted: false },
    }
    const out = enrichManifestForContext(base, { compactRules: ['r1'], protocolPath: '/d/AGENTS.md', contextDocPath: '/d/tasks/u1/index.md' })
    expect(out.compactRules).toEqual(['r1'])
    expect(out.protocolPath).toBe('/d/AGENTS.md')
    expect(out.contextDocPath).toBe('/d/tasks/u1/index.md')
    expect(out.kind).toBe('task')
  })

  it('returns the input unchanged when given null context (protocol disabled)', () => {
    const base: ManifestInput = { kind: 'project', projectName: 'Berth', docsRoot: '/d', projectTodos: [] }
    const out = enrichManifestForContext(base, null)
    expect(out.compactRules).toBeUndefined()
  })
})
