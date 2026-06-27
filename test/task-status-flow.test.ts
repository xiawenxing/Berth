import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore } from '../src/db/store'
import { listTasks } from '../src/data/tasks'

// A controllable stand-in for pty-registry's activity bus: startTaskStatusFlow imports
// subscribeActivity directly, so we mock the module and drive callbacks from `activityBus.emit`.
const activityBus = vi.hoisted(() => {
  const subs: Array<(e: any) => void> = []
  return {
    subscribeActivity: (cb: (e: any) => void) => {
      subs.push(cb)
      return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1) }
    },
    emit: (e: any) => { for (const cb of [...subs]) cb(e) },
    reset: () => { subs.length = 0 },
  }
})
vi.mock('../src/server/pty-registry', () => ({ subscribeActivity: activityBus.subscribeActivity }))

import { reconcileTaskStatusForSession, startTaskStatusFlow } from '../src/server/task-status-flow'

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

  it('no-ops (no throw) for a bound task when getSession returns null', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-ns', '进行中')
    store.addEdge('task-ns', 'sess-ns')
    expect(() => reconcileTaskStatusForSession({
      store, sessionId: 'sess-ns',
      getSession: () => null,
    })).not.toThrow()
    expect(find(store, 'task-ns')?.status).toBe('进行中')
  })
})

describe('startTaskStatusFlow', () => {
  afterEach(() => {
    activityBus.reset()
    vi.useRealTimers()
  })

  it('a `running` event cancels a pending settle-debounce (no mid-turn reconcile)', () => {
    vi.useFakeTimers()
    const store = openStore(':memory:')
    seedTask(store, 'task-c', '进行中')
    store.addEdge('task-c', 'sess-c')
    const path = writeClaudeTranscript('task-c', '已完成')
    const stop = startTaskStatusFlow({
      store, debounceMs: 50,
      getSession: () => ({ sessionId: 'sess-c', cli: 'claude', contentSourcePath: path }),
    })

    activityBus.emit({ kind: 'state', sessionId: 'sess-c', state: 'settled' })
    activityBus.emit({ kind: 'state', sessionId: 'sess-c', state: 'running' })  // cancels the timer
    vi.advanceTimersByTime(100)

    expect(find(store, 'task-c')?.status).toBe('进行中')   // reconcile must NOT have run
    stop()
  })

  it('settle → debounce elapsed → sentinel applied', () => {
    vi.useFakeTimers()
    const store = openStore(':memory:')
    seedTask(store, 'task-d', '进行中')
    store.addEdge('task-d', 'sess-d')
    const path = writeClaudeTranscript('task-d', '已完成')
    const stop = startTaskStatusFlow({
      store, debounceMs: 50,
      getSession: () => ({ sessionId: 'sess-d', cli: 'claude', contentSourcePath: path }),
    })

    activityBus.emit({ kind: 'state', sessionId: 'sess-d', state: 'settled' })
    vi.advanceTimersByTime(60)

    expect(find(store, 'task-d')?.status).toBe('已完成')
    stop()
  })

  it('a throwing reconcile is isolated; a later session still reconciles', () => {
    vi.useFakeTimers()
    const store = openStore(':memory:')
    seedTask(store, 'task-err', '进行中')
    store.addEdge('task-err', 'sess-err')
    seedTask(store, 'task-ok', '进行中')
    store.addEdge('task-ok', 'sess-ok')
    const okPath = writeClaudeTranscript('task-ok', '已完成')
    const stop = startTaskStatusFlow({
      store, debounceMs: 50,
      getSession: (sid) => {
        if (sid === 'sess-err') throw new Error('boom')
        return { sessionId: 'sess-ok', cli: 'claude', contentSourcePath: okPath }
      },
    })

    activityBus.emit({ kind: 'state', sessionId: 'sess-err', state: 'settled' })
    expect(() => vi.advanceTimersByTime(60)).not.toThrow()   // subscriber swallowed the error
    expect(find(store, 'task-err')?.status).toBe('进行中')    // unchanged

    activityBus.emit({ kind: 'state', sessionId: 'sess-ok', state: 'settled' })
    vi.advanceTimersByTime(60)
    expect(find(store, 'task-ok')?.status).toBe('已完成')      // the good session still works
    stop()
  })

  it('teardown clears pending timers (no reconcile after unsubscribe)', () => {
    vi.useFakeTimers()
    const store = openStore(':memory:')
    seedTask(store, 'task-t', '进行中')
    store.addEdge('task-t', 'sess-t')
    const path = writeClaudeTranscript('task-t', '已完成')
    const stop = startTaskStatusFlow({
      store, debounceMs: 50,
      getSession: () => ({ sessionId: 'sess-t', cli: 'claude', contentSourcePath: path }),
    })

    activityBus.emit({ kind: 'state', sessionId: 'sess-t', state: 'settled' })
    stop()                          // clears the pending timer + unsubscribes
    vi.advanceTimersByTime(100)

    expect(find(store, 'task-t')?.status).toBe('进行中')   // never reconciled
  })
})
