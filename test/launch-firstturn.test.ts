import { describe, it, expect } from 'vitest'
import { shouldArmFirstTurnNudge, armFirstTurnNudge } from '../src/server/launch-firstturn'

describe('shouldArmFirstTurnNudge', () => {
  it('arms for TUI claude/coco with a first turn', () => {
    expect(shouldArmFirstTurnNudge({ cli: 'claude', mode: 'tui', hasInitialPrompt: true })).toBe(true)
    expect(shouldArmFirstTurnNudge({ cli: 'coco', mode: 'tui', hasInitialPrompt: true })).toBe(true)
  })
  it('does NOT arm for codex (own watcher + reliable submit)', () => {
    expect(shouldArmFirstTurnNudge({ cli: 'codex', mode: 'tui', hasInitialPrompt: true })).toBe(false)
  })
  it('does NOT arm for Model B (turn rides stdin)', () => {
    expect(shouldArmFirstTurnNudge({ cli: 'claude', mode: 'stream', hasInitialPrompt: true })).toBe(false)
  })
  it('does NOT arm without a first turn (idle/free launch)', () => {
    expect(shouldArmFirstTurnNudge({ cli: 'claude', mode: 'tui', hasInitialPrompt: false })).toBe(false)
  })
})

describe('armFirstTurnNudge', () => {
  function runner() {
    const scheduled: Array<() => void> = []
    return { scheduled, schedule: (fn: () => void) => { scheduled.push(fn) } }
  }

  it('fires Enter when the launch is alive and has not surfaced', () => {
    const r = runner()
    let sent = 0
    armFirstTurnNudge({ alive: () => true, surfaced: () => false, sendEnter: () => { sent++ }, delaysMs: [10], schedule: r.schedule })
    r.scheduled.forEach((fn) => fn())
    expect(sent).toBe(1)
  })

  it('skips when the turn already happened (no double-submit)', () => {
    const r = runner()
    let sent = 0
    armFirstTurnNudge({ alive: () => true, surfaced: () => true, sendEnter: () => { sent++ }, delaysMs: [10], schedule: r.schedule })
    r.scheduled.forEach((fn) => fn())
    expect(sent).toBe(0)
  })

  it('skips when the pty already exited', () => {
    const r = runner()
    let sent = 0
    armFirstTurnNudge({ alive: () => false, surfaced: () => false, sendEnter: () => { sent++ }, delaysMs: [10], schedule: r.schedule })
    r.scheduled.forEach((fn) => fn())
    expect(sent).toBe(0)
  })

  it('second attempt cancels itself once a turn lands between attempts', () => {
    const r = runner()
    let surfaced = false
    const attempts: Array<{ fired: boolean; i: number }> = []
    armFirstTurnNudge({
      alive: () => true,
      surfaced: () => surfaced,
      sendEnter: () => { surfaced = true },   // the nudge produces a turn
      onAttempt: (fired, i) => attempts.push({ fired, i }),
      delaysMs: [10, 20],
      schedule: r.schedule,
    })
    r.scheduled.forEach((fn) => fn())   // run both attempts in order
    expect(attempts).toEqual([{ fired: true, i: 0 }, { fired: false, i: 1 }])
  })
})
