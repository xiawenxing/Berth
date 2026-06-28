import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { bindIntentToSession } from '../src/server/bind'
import type { LaunchIntent } from '../src/types'

function intent(over: Partial<LaunchIntent> = {}): LaunchIntent {
  return { id: 'i1', cli: 'codex', cwd: '/proj', projectId: null, todoKey: null, sessionId: null, createdAt: 1000, bound: false, ...over }
}

describe('bindIntentToSession', () => {
  it('writes edge + attach + marks the intent bound', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: 'task-A', projectId: 'P' }))
    bindIntentToSession(s, intent({ todoKey: 'task-A', projectId: 'P' }), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBe('task-A')
    expect(s.getAttach('real-sid')).toMatchObject({ projectId: 'P', state: 'confirmed' })
    expect(s.pendingIntents()).toEqual([])
  })

  it('skips edge when todoKey is null and skips attach when projectId is null', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent())
    bindIntentToSession(s, intent(), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBeNull()
    expect(s.getAttach('real-sid')).toBeNull()
    expect(s.allBoundLaunchSessionIds().has('real-sid')).toBe(true)
  })

  it('is idempotent — binding the same pair twice writes one edge', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: 'task-A' }))
    bindIntentToSession(s, intent({ todoKey: 'task-A' }), 'real-sid')
    bindIntentToSession(s, intent({ todoKey: 'task-A' }), 'real-sid')
    expect(s.edgesByTodo().get('task-A')).toEqual(['real-sid'])
    expect(s.pendingIntents()).toEqual([])
  })

  it('writes edge but no attach when projectId is null', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: 'task-A', projectId: null }))
    bindIntentToSession(s, intent({ todoKey: 'task-A', projectId: null }), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBe('task-A')
    expect(s.getAttach('real-sid')).toBeNull()
    expect(s.pendingIntents()).toEqual([])
  })

  it('writes attach but no edge when todoKey is null', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: null, projectId: 'P' }))
    bindIntentToSession(s, intent({ todoKey: null, projectId: 'P' }), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBeNull()
    expect(s.getAttach('real-sid')).toMatchObject({ projectId: 'P', state: 'confirmed' })
    expect(s.pendingIntents()).toEqual([])
  })
})
