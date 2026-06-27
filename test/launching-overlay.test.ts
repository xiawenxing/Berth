import { describe, it, expect } from 'vitest'
import { launchingOverlay } from '../src/server/api'
import type { LaunchIntent } from '../src/types'

function intent(p: Partial<LaunchIntent>): LaunchIntent {
  return { id: 'i1', cli: 'claude', cwd: '/repo', projectId: null, todoKey: null, sessionId: 's1', createdAt: 100, bound: true, ...p }
}
const deps = {
  pins: new Set<string>(),
  attach: new Map<string, { projectId: string | null; state: string }>(),
  projectNames: new Map<string, string>(),
  todoKeyFor: () => null,
  activity: new Map<string, 'running' | 'settled'>(),
}

describe('launchingOverlay', () => {
  it('surfaces a bound launch with a live pty that has not yet written a jsonl', () => {
    const rows = launchingOverlay([intent({})], new Set(), () => true, deps)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 's1', cli: 'claude', cwd: '/repo', launching: true, title: null })
    expect(rows[0].activity).toBe('running')   // mid-boot
  })

  it('skips a launch that already surfaced from disk (real row wins)', () => {
    const rows = launchingOverlay([intent({})], new Set(['s1']), () => true, deps)
    expect(rows).toHaveLength(0)
  })

  it('skips a dead launch (pty gone) — no non-recoverable ghost', () => {
    const rows = launchingOverlay([intent({})], new Set(), () => false, deps)
    expect(rows).toHaveLength(0)
  })

  it('keys codex (no minted sessionId) by intent id until reconcile', () => {
    const rows = launchingOverlay([intent({ cli: 'codex', sessionId: null, id: 'intent-x' })], new Set(), (k) => k === 'intent-x', deps)
    expect(rows).toHaveLength(1)
    expect(rows[0].sessionId).toBe('intent-x')
  })

  it('does not duplicate when two intents resolve to the same key', () => {
    const rows = launchingOverlay([intent({}), intent({ id: 'i2' })], new Set(), () => true, deps)
    expect(rows).toHaveLength(1)
  })

  it('carries project + todo attribution', () => {
    const rows = launchingOverlay(
      [intent({ projectId: 'p1', todoKey: 't1' })],
      new Set(),
      () => true,
      { ...deps, projectNames: new Map([['p1', 'Berth']]) },
    )
    expect(rows[0]).toMatchObject({ projectId: 'p1', project: 'Berth', todoKey: 't1' })
  })
})
