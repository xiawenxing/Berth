import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootGraceHold, codexTurnStarted, watchCodexFirstTurn, CODEX_TURN_WATCH_INTERVAL_MS, CODEX_TURN_WATCH_TIMEOUT_MS } from '../src/server/launch-ready'

describe('bootGraceHold', () => {
  it('holds running only within the grace window', () => {
    let t = 1000
    const hold = bootGraceHold(8000, () => t)
    expect(hold('s')).toBe(true)      // t=1000, 0ms in
    t = 8999
    expect(hold('s')).toBe(true)      // 7999ms in — still held
    t = 9001
    expect(hold('s')).toBe(false)     // 8001ms in — released
  })
})

describe('codexTurnStarted', () => {
  let dir = ''
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'berth-codex-')) })
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })

  it('is false for a null path or a rollout with no lifecycle event', () => {
    expect(codexTurnStarted(null)).toBe(false)
    const p = join(dir, 'a.jsonl')
    writeFileSync(p, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }) + '\n')
    expect(codexTurnStarted(p)).toBe(false)
  })

  it('is true once the rollout records task_started (the first turn began)', () => {
    const p = join(dir, 'b.jsonl')
    writeFileSync(p, JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }) + '\n')
    expect(codexTurnStarted(p)).toBe(true)
  })

  it('is true even if the turn already completed (boot is definitively over)', () => {
    const p = join(dir, 'c.jsonl')
    writeFileSync(p,
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }) + '\n' +
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } }) + '\n')
    expect(codexTurnStarted(p)).toBe(true)
  })
})

describe('watchCodexFirstTurn', () => {
  afterEach(() => { vi.useRealTimers() })

  it('refreshes until bound, then emits once the rollout shows a turn', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'berth-watch-'))
    const rollout = join(dir, 'rollout.jsonl')
    let bound: string | null = null
    let refreshes = 0
    const emitted: string[] = []
    // Bind on the 2nd refresh; turn starts a bit after that.
    const refresh = () => { refreshes++; if (refreshes >= 2) bound = 'real-sid' }

    watchCodexFirstTurn({
      refresh,
      boundSessionId: () => bound,
      pathFor: (sid) => (sid === 'real-sid' ? rollout : null),
      alive: () => true,
      emit: (sid) => emitted.push(sid),
    })

    vi.advanceTimersByTime(CODEX_TURN_WATCH_INTERVAL_MS)       // tick 1: refresh, not bound
    expect(emitted).toEqual([])
    vi.advanceTimersByTime(CODEX_TURN_WATCH_INTERVAL_MS)       // tick 2: refresh → bound, path set, no turn yet
    expect(bound).toBe('real-sid')
    expect(emitted).toEqual([])
    writeFileSync(rollout, JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }) + '\n')
    vi.advanceTimersByTime(CODEX_TURN_WATCH_INTERVAL_MS)       // tick 3: turn started → emit
    expect(emitted).toEqual(['real-sid'])
    // No further emits after it stops.
    vi.advanceTimersByTime(CODEX_TURN_WATCH_INTERVAL_MS * 4)
    expect(emitted).toEqual(['real-sid'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('gives up if the session dies before any turn', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    let aliveFlag = true
    watchCodexFirstTurn({
      refresh: () => {},
      boundSessionId: () => 'sid',
      pathFor: () => null,
      alive: () => aliveFlag,
      emit: (sid) => emitted.push(sid),
    })
    aliveFlag = false
    vi.advanceTimersByTime(CODEX_TURN_WATCH_INTERVAL_MS)
    vi.advanceTimersByTime(CODEX_TURN_WATCH_TIMEOUT_MS)
    expect(emitted).toEqual([])
  })
})
