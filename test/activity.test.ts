import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityHub, hasVisibleOutput } from '../src/server/activity'

describe('hasVisibleOutput', () => {
  it('is true for real text output', () => {
    expect(hasVisibleOutput('Done.')).toBe(true)
    expect(hasVisibleOutput('\x1b[1m\x1b[32mhi\x1b[0m')).toBe(true)   // styled text
  })
  it('is false for pure cursor/repaint escape noise (an idle TUI redraw)', () => {
    expect(hasVisibleOutput('\x1b[2J\x1b[H')).toBe(false)            // clear + home
    expect(hasVisibleOutput('\x1b[?25l\x1b[10;5H\x1b[?25h')).toBe(false) // hide/move/show cursor
    expect(hasVisibleOutput('\x1b7\x1b[6n\x1b8')).toBe(false)        // save / query / restore cursor
  })
  it('is false for whitespace/control-only chunks', () => {
    expect(hasVisibleOutput('')).toBe(false)
    expect(hasVisibleOutput('\r\n  \t')).toBe(false)
  })
})

describe('ActivityHub', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a turn-starting register (fresh launch with a prompt) emits running', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.register('s1', { running: true })

    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'running' }])
    expect(hub.snapshot()).toEqual([{ sessionId: 's1', state: 'running' }])
  })

  it('a passive register (resume / open-to-view) emits nothing and stays out of the snapshot', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.register('s1')   // resuming an old session just to view it — NOT a turn

    expect(events).toEqual([])
    expect(hub.snapshot()).toEqual([])
  })

  it('ignores output from a session that has not started a turn (resume redraw / idle repaint)', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1')   // resumed, idle
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.data('s1'); hub.data('s1')   // the CLI redraws its screen on resume
    vi.advanceTimersByTime(5000)

    expect(events).toEqual([])       // never running, never settled → no spurious spinner/dot
    expect(hub.snapshot()).toEqual([])
  })

  it('an Enter-terminated input starts a turn even on a resumed idle session', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1')   // idle
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.input('s1', 'hi')   // typing, not submitted
    expect(events).toEqual([])
    hub.input('s1', '\r')   // Enter → turn submitted
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'running' }])
  })

  it('sustains a running turn while output flows, then settles after idleMs', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1', { running: true })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    vi.advanceTimersByTime(800)
    hub.data('s1')                    // streaming output → rearm
    vi.advanceTimersByTime(800)
    expect(events).toEqual([])        // 1600ms total but only 800ms since last output
    vi.advanceTimersByTime(200)
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'settled' }])
  })

  it('can hold a silent running turn until a CLI-specific completion guard clears', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    let stillRunning = true
    hub.register('s1', { running: true, holdRunning: () => stillRunning })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    vi.advanceTimersByTime(1000)
    expect(events).toEqual([])
    expect(hub.snapshot()).toEqual([{ sessionId: 's1', state: 'running' }])

    stillRunning = false
    vi.advanceTimersByTime(1000)
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'settled' }])
  })

  it('does not re-emit running while already running (dedupe)', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1', { running: true })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.data('s1')
    expect(events).toEqual([])
  })

  it('output after a settle resumes running (mid-turn silence recovers)', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1', { running: true })
    vi.advanceTimersByTime(1000)      // settled
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.data('s1')
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'running' }])
  })

  it('emits exited for a shown session and cancels the pending idle timer', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1', { running: true })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.exit('s1')
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'exited' }])
    expect(hub.snapshot()).toEqual([])
    vi.advanceTimersByTime(5000)
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'exited' }])
  })

  it('exiting a never-shown idle session emits nothing', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('s1')   // idle, never shown
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.exit('s1')
    expect(events).toEqual([])
  })

  it('rekeys a running session: moves state, emits rekey, settle fires under the new key', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    hub.register('intent-x', { running: true })
    const events: any[] = []
    hub.subscribe(e => events.push(e))

    hub.rekey('intent-x', 'real-id')

    expect(events).toEqual([{ kind: 'rekey', from: 'intent-x', to: 'real-id' }])
    expect(hub.snapshot()).toEqual([{ sessionId: 'real-id', state: 'running' }])
    vi.advanceTimersByTime(1000)
    expect(events).toContainEqual({ kind: 'state', sessionId: 'real-id', state: 'settled' })
  })

  it('stops delivering events after unsubscribe', () => {
    const hub = new ActivityHub({ idleMs: 1000 })
    const events: any[] = []
    const off = hub.subscribe(e => events.push(e))
    hub.register('s1', { running: true })
    off()
    hub.exit('s1')
    expect(events).toEqual([{ kind: 'state', sessionId: 's1', state: 'running' }])
  })
})
