import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE_READY, shouldMarkLaunchReady, shouldRevealLaunch } from './launch-readiness'

describe('shouldMarkLaunchReady', () => {
  it('treats bracketed-paste enable as a readiness signal for claude', () => {
    expect(shouldMarkLaunchReady({
      cli: 'claude',
      recentOutput: `banner ${BRACKETED_PASTE_READY}`,
      sawData: true,
      quietMs: 0,
      elapsedMs: 100,
    })).toBe(true)
  })

  it('does NOT trust the bracketed-paste marker for codex (it enables paste during its banner)', () => {
    // Codex turns on paste mode while still printing its startup banner / update notice, long before
    // the composer exists — trusting it there dropped the boot mask mid-startup.
    expect(shouldMarkLaunchReady({
      cli: 'codex',
      recentOutput: `early ${BRACKETED_PASTE_READY}`,
      sawData: true,
      quietMs: 100,
      elapsedMs: 100,
      stableMs: 900,
    })).toBe(false)
  })

  it('marks any launch ready after startup output goes quiet', () => {
    expect(shouldMarkLaunchReady({
      cli: 'codex',
      recentOutput: 'startup banner',
      sawData: true,
      quietMs: 901,
      elapsedMs: 1200,
      stableMs: 900,
    })).toBe(true)
  })

  it('has a fallback for CLIs that never print a ready-ish signal', () => {
    expect(shouldMarkLaunchReady({
      cli: 'codex',
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
    expect(shouldRevealLaunch({ sawData: true, quietMs: 400 })).toBe(true)
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
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: '', sawData: true, quietMs: 400, elapsedMs: 500 })).toBe(false)
  })
})
