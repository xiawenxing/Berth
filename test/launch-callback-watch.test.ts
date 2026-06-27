import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { scanLaunchCallbacks } from '../src/server/launch-callback-watch'

const envelope = (sessionId: string, cwd: string) =>
  JSON.stringify({ session_id: sessionId, cwd, hook_event_name: 'SessionStart' })

describe('scanLaunchCallbacks', () => {
  it('binds a pending intent from a dropped callback file and removes the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-cb-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'tok-1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
      writeFileSync(join(dir, 'tok-1.json'), envelope('real-sid', '/proj'))
      scanLaunchCallbacks(s, dir)
      expect(s.todoKeyForSession('real-sid')).toBe('task-A')
      expect(existsSync(join(dir, 'tok-1.json'))).toBe(false)   // consumed
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('leaves a partial/invalid file in place for retry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-cb-'))
    try {
      const s = openStore(':memory:')
      writeFileSync(join(dir, 'tok-x.json'), '{ partial')
      scanLaunchCallbacks(s, dir)
      expect(existsSync(join(dir, 'tok-x.json'))).toBe(true)   // left for retry
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('removes a parseable callback whose token matches no pending intent (stale/redundant)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-cb-'))
    try {
      const s = openStore(':memory:')
      writeFileSync(join(dir, 'gone.json'), envelope('sid', '/proj'))
      scanLaunchCallbacks(s, dir)
      expect(existsSync(join(dir, 'gone.json'))).toBe(false)   // no accumulation
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
