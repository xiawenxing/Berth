import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE_READY, shouldMarkLaunchReady, shouldRevealLaunch } from './launch-readiness'

describe('shouldMarkLaunchReady', () => {
  it('treats bracketed-paste enable as a readiness signal for any CLI', () => {
    for (const cli of ['claude', 'codex', 'coco']) {
      expect(shouldMarkLaunchReady({
        recentOutput: `banner ${BRACKETED_PASTE_READY}`,
        sawData: true,
        quietMs: 0,
        elapsedMs: 100,
      }), cli).toBe(true)
    }
  })

  it('ignores the bracketed-paste marker until data has actually been seen', () => {
    expect(shouldMarkLaunchReady({
      recentOutput: BRACKETED_PASTE_READY,
      sawData: false,
      quietMs: 0,
      elapsedMs: 100,
    })).toBe(false)
  })

  it('marks any launch ready after startup output goes quiet', () => {
    expect(shouldMarkLaunchReady({
      recentOutput: 'startup banner',
      sawData: true,
      quietMs: 901,
      elapsedMs: 1200,
      stableMs: 900,
    })).toBe(true)
  })

  it('has a fallback for CLIs that never print a ready-ish signal', () => {
    expect(shouldMarkLaunchReady({
      recentOutput: '',
      sawData: false,
      quietMs: 0,
      elapsedMs: 30_000,
      fallbackMs: 30_000,
    })).toBe(true)
  })
})

describe('shouldRevealLaunch', () => {
  it('reveals once output has been seen and then goes quiet briefly', () => {
    expect(shouldRevealLaunch({ sawData: true, quietMs: 350 })).toBe(true)
    expect(shouldRevealLaunch({ sawData: true, quietMs: 1000 })).toBe(true)
  })

  it('does not reveal while output is still streaming', () => {
    expect(shouldRevealLaunch({ sawData: true, quietMs: 100 })).toBe(false)
  })

  it('does not reveal before any output has arrived', () => {
    expect(shouldRevealLaunch({ sawData: false, quietMs: 5000 })).toBe(false)
  })

  it('reveals well before the full ready threshold (900ms quiet)', () => {
    // The whole point: surface a HITL fast, not after a near-second of silence.
    expect(shouldRevealLaunch({ sawData: true, quietMs: 400 })).toBe(true)
    expect(shouldMarkLaunchReady({ recentOutput: '', sawData: true, quietMs: 400, elapsedMs: 500 })).toBe(false)
  })
})
