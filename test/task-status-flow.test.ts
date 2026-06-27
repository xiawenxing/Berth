import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore } from '../src/db/store'
import { listTasks } from '../src/data/tasks'
import { reconcileTaskStatusForSession } from '../src/server/task-status-flow'

// Insert a task row directly (synchronous, no AI/docStore) — same shape the onboarding seed uses.
function seedTask(store: any, id: string, status: string): void {
  store.insertTask({
    id, title: 'do it', status, priority: 'P1',
    projectId: null, project: null, detailDoc: null, progress: null,
    updatedAt: 1000, syncedAt: 0, deleted: false,
  })
}

// Minimal claude jsonl transcript whose only assistant text carries a sentinel.
function writeClaudeTranscript(taskId: string, status: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-flow-'))
  const file = join(dir, 'sess.jsonl')
  const line = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: `done\nBERTH_TASK_STATUS: ${taskId} ${status}` }] },
  })
  writeFileSync(file, line + '\n')
  return file
}

const find = (store: any, id: string) => listTasks(store).find((x: any) => x.id === id)

describe('reconcileTaskStatusForSession', () => {
  it('applies the sentinel when the task is still in progress (Path B)', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-1', '进行中')
    store.addEdge('task-1', 'sess-1')
    const path = writeClaudeTranscript('task-1', '已完成')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-1',
      getSession: () => ({ sessionId: 'sess-1', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-1')?.status).toBe('已完成')
  })

  it('no-ops when the task already moved off 进行中 (Path A worked)', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-2', '已完成')
    store.addEdge('task-2', 'sess-2')
    const path = writeClaudeTranscript('task-2', '阻塞')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-2',
      getSession: () => ({ sessionId: 'sess-2', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-2')?.status).toBe('已完成')   // unchanged
  })

  it('leaves 进行中 when no sentinel is present', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-3', '进行中')
    store.addEdge('task-3', 'sess-3')
    const dir = mkdtempSync(join(tmpdir(), 'berth-flow-'))
    const path = join(dir, 's.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'no marker' }] } }) + '\n')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-3',
      getSession: () => ({ sessionId: 'sess-3', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-3')?.status).toBe('进行中')
  })

  it('no-ops for a session with no bound task', () => {
    const store = openStore(':memory:')
    expect(() => reconcileTaskStatusForSession({
      store, sessionId: 'unbound',
      getSession: () => ({ sessionId: 'unbound', cli: 'claude', contentSourcePath: null }),
    })).not.toThrow()
  })
})
