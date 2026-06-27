import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { rolloutDayDir, bindFromRollout } from '../src/server/rollout-watch'

describe('rolloutDayDir', () => {
  it('builds <home>/sessions/YYYY/MM/DD from a UTC date', () => {
    expect(rolloutDayDir(new Date('2026-06-27T12:00:00Z'), '/H')).toBe(join('/H', 'sessions', '2026', '06', '27'))
  })
})

describe('bindFromRollout', () => {
  it('binds a pending codex intent from a matching rollout first line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-rollout-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: dir, projectId: 'P', todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
      const path = join(dir, 'rollout-x.jsonl')
      writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { session_id: 'sid-1', cwd: dir, timestamp: new Date(1005_000).toISOString() } }) + '\n')
      expect(bindFromRollout(s, path)).toBe(true)
      expect(s.todoKeyForSession('sid-1')).toBe('task-A')
      expect(s.pendingIntents()).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rekeys with (intentId, sessionId) and no-ops on a second call (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-rollout-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: dir, projectId: null, todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
      const path = join(dir, 'rollout-z.jsonl')
      writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { session_id: 'sid-z', cwd: dir, timestamp: new Date(1005_000).toISOString() } }) + '\n')
      const rekeyed: Array<[string, string]> = []
      expect(bindFromRollout(s, path, { rekey: (a, b) => rekeyed.push([a, b]) })).toBe(true)
      expect(rekeyed).toEqual([['i1', 'sid-z']])
      // second call: intent already bound → no match → false, no extra rekey
      expect(bindFromRollout(s, path, { rekey: (a, b) => rekeyed.push([a, b]) })).toBe(false)
      expect(rekeyed).toEqual([['i1', 'sid-z']])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not bind when the rollout cwd matches no pending intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-rollout-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/other', projectId: null, todoKey: null, sessionId: null, createdAt: 1000, bound: false })
      const path = join(dir, 'rollout-y.jsonl')
      writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { session_id: 'sid', cwd: dir, timestamp: new Date(1005_000).toISOString() } }) + '\n')
      expect(bindFromRollout(s, path)).toBe(false)
      expect(s.pendingIntents().length).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
