import { describe, it, expect } from 'vitest'
import { synthLaunchingSessions } from '../src/sessions'
import type { LaunchIntent } from '../src/types'

function intent(p: Partial<LaunchIntent>): LaunchIntent {
  return { id: 'i1', cli: 'claude', cwd: '/repo', projectId: null, todoKey: null, sessionId: 's1', createdAt: 100, bound: true, ...p }
}

describe('synthLaunchingSessions (the live-PTY arm of session visibility)', () => {
  it('synthesizes a transient session for a launch with a live pty not yet on disk', () => {
    const rows = synthLaunchingSessions([intent({})], new Set(), () => true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 's1', cli: 'claude', cwd: '/repo', launching: true, title: null, deleted: false })
    expect(rows[0].contentSourcePath).toBeNull()
  })

  it('skips a launch already surfaced on disk (the real row wins)', () => {
    expect(synthLaunchingSessions([intent({})], new Set(['s1']), () => true)).toHaveLength(0)
  })

  it('skips a dead launch (pty gone) — no non-recoverable ghost', () => {
    expect(synthLaunchingSessions([intent({})], new Set(), () => false)).toHaveLength(0)
  })

  it('covers codex pre-reconcile: keys by intent id when sessionId is unknown', () => {
    const rows = synthLaunchingSessions(
      [intent({ cli: 'codex', sessionId: null, id: 'intent-x', bound: false })],
      new Set(),
      (k) => k === 'intent-x',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].sessionId).toBe('intent-x')
  })

  it('does not duplicate when two intents resolve to the same launch key', () => {
    expect(synthLaunchingSessions([intent({}), intent({ id: 'i2' })], new Set(), () => true)).toHaveLength(1)
  })

  it('uses the intent createdAt as updatedAt (sorts to the top of a recent list)', () => {
    const rows = synthLaunchingSessions([intent({ createdAt: 12345 })], new Set(), () => true)
    expect(rows[0].updatedAt).toBe(12345)
  })
})
