import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE_READY, cliReadiness, shouldMarkLaunchReady, shouldRevealLaunch } from './launch-readiness'

describe('cliReadiness', () => {
  it('trusts bracketed paste for claude only', () => {
    expect(cliReadiness('claude').trustBracketedPaste).toBe(true)
    expect(cliReadiness('codex').trustBracketedPaste).toBe(false)
    expect(cliReadiness('coco').trustBracketedPaste).toBe(false)
  })

  it('gives codex AND coco longer quiet thresholds than claude (to clear their ~1s boot spinner)', () => {
    for (const cli of ['codex', 'coco']) {
      expect(cliReadiness(cli).revealQuietMs, cli).toBeGreaterThan(cliReadiness('claude').revealQuietMs)
      expect(cliReadiness(cli).stableReadyMs, cli).toBeGreaterThan(cliReadiness('claude').stableReadyMs)
      // Must clear a ~1s spinner tick with margin, or the mask tears down mid-boot.
      expect(cliReadiness(cli).revealQuietMs, cli).toBeGreaterThan(1000)
      expect(cliReadiness(cli).stableReadyMs, cli).toBeGreaterThan(1000)
    }
  })
})

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

  it('does NOT trust the bracketed-paste marker for codex (it enables paste at byte 0)', () => {
    expect(shouldMarkLaunchReady({
      cli: 'codex',
      recentOutput: `early ${BRACKETED_PASTE_READY}`,
      sawData: true,
      quietMs: 100,
      elapsedMs: 100,
    })).toBe(false)
  })

  it('NEVER marks codex ready on output-quiet (deterministic frame drives it; model:loading pauses must not flash the boot)', () => {
    // Even a long silence (codex loading the model) must not drop the mask — only the server
    // turnStarted frame (or the fallback) does. quietMarksReady:false for codex.
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: 'banner', sawData: true, quietMs: 950, elapsedMs: 4000 })).toBe(false)
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: 'model: loading', sawData: true, quietMs: 6000, elapsedMs: 8000 })).toBe(false)
  })

  it('still marks coco ready on quiet (no deterministic frame), past its longer window', () => {
    expect(shouldMarkLaunchReady({ cli: 'coco', recentOutput: 'banner', sawData: true, quietMs: 1700, elapsedMs: 4000 })).toBe(true)
    expect(shouldMarkLaunchReady({ cli: 'coco', recentOutput: 'banner', sawData: true, quietMs: 950, elapsedMs: 4000 })).toBe(false)
  })

  it('marks a default/unknown CLI ready after the standard quiet window', () => {
    expect(shouldMarkLaunchReady({ cli: 'gemini', recentOutput: 'startup banner', sawData: true, quietMs: 901, elapsedMs: 1200 })).toBe(true)
  })

  it('has a fallback for CLIs that never print a ready-ish signal', () => {
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: '', sawData: false, quietMs: 0, elapsedMs: 30_000 })).toBe(true)
  })
})

describe('shouldRevealLaunch', () => {
  it('reveals claude on a brief quiet (early HITL surfaces fast)', () => {
    expect(shouldRevealLaunch({ cli: 'claude', sawData: true, quietMs: 400 })).toBe(true)
  })

  it('does not reveal codex during normal boot pauses (model:loading clears under the window)', () => {
    expect(shouldRevealLaunch({ cli: 'codex', sawData: true, quietMs: 900 })).toBe(false)
    expect(shouldRevealLaunch({ cli: 'codex', sawData: true, quietMs: 2000 })).toBe(false)
  })

  it('reveals codex only once quiet past its long window (a genuinely stuck pre-turn HITL)', () => {
    expect(shouldRevealLaunch({ cli: 'codex', sawData: true, quietMs: 2600 })).toBe(true)
  })

  it('does not reveal before any output has arrived', () => {
    expect(shouldRevealLaunch({ cli: 'claude', sawData: false, quietMs: 5000 })).toBe(false)
  })
})
