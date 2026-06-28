import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/agent/triage', () => ({ classifyProject: vi.fn() }))
vi.mock('../src/agent/index', () => ({ generateTaskTitle: vi.fn() }))
vi.mock('../src/data/task-summary', () => ({ triggerTaskSummary: vi.fn() }))

import { openStore } from '../src/db/store'
import { createProject } from '../src/data/projects'
import { listTasks } from '../src/data/tasks'
import { classifyProject } from '../src/agent/triage'
import { generateTaskTitle } from '../src/agent/index'
import { triggerTaskSummary } from '../src/data/task-summary'
import { createTaskFromSession } from '../src/data/task-from-session'

function fakeDocStore() {
  return {
    saveAttachment: (_d: string, _h: string) => ({ rel: 'assets/x.png', abs: '/root/assets/x.png' }),
    taskDocRef: (id: string) => `tasks/${id}/index.md`,
    resolveDocPath: (ref: string) => `/root/${ref}`,
    writeDoc: (_abs: string, _content: string) => ({ mtime: 1 }),
  } as any
}

describe('data/task-from-session', () => {
  beforeEach(() => {
    ;(classifyProject as any).mockReset()
    ;(generateTaskTitle as any).mockReset()
    ;(triggerTaskSummary as any).mockReset()
  })

  it('generates a title from the digest, creates the task, links the session, triggers a summary', async () => {
    const store = openStore(':memory:')
    const proj = createProject(store, 'Berth', 'Blue')
    ;(generateTaskTitle as any).mockResolvedValue('修复会话被 kill 后状态错乱')

    const r = await createTaskFromSession(store, fakeDocStore(), 'sess-1', 'USER: 会话被 kill 了\nASSISTANT: 我来排查', { projectId: proj.id })

    expect(r.status).toBe('created')
    expect((generateTaskTitle as any).mock.calls[0][0]).toContain('会话被 kill')
    if (r.status === 'created') {
      expect(r.record.title).toBe('修复会话被 kill 后状态错乱')
      expect(store.edgesByTodo().get(r.record.id)).toContain('sess-1')
      expect((triggerTaskSummary as any)).toHaveBeenCalledWith(store, r.record.id)
    }
    expect(listTasks(store)).toHaveLength(1)
  })

  it('throws on empty digest (no agent call, no task)', async () => {
    const store = openStore(':memory:')
    await expect(createTaskFromSession(store, fakeDocStore(), 'sess-1', '   ', {})).rejects.toThrow(/empty session content/)
    expect((generateTaskTitle as any)).not.toHaveBeenCalled()
    expect(listTasks(store)).toHaveLength(0)
  })

  it('throws when the agent returns an empty title (no task created)', async () => {
    const store = openStore(':memory:')
    ;(generateTaskTitle as any).mockResolvedValue('   ')
    await expect(createTaskFromSession(store, fakeDocStore(), 'sess-1', 'USER: hi', {})).rejects.toThrow(/empty title/)
    expect(listTasks(store)).toHaveLength(0)
  })
})
