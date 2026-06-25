import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE_READY, cliReadiness, shouldMarkLaunchReady, shouldRevealLaunch } from './launch-readiness'

describe('cliReadiness', () => {
  it('trusts bracketed paste for claude only', () => {
    expect(cliReadiness('claude').trustBracketedPaste).toBe(true)
    expect(cliReadiness('codex').trustBracketedPaste).toBe(false)
    expect(cliReadiness('coco').trustBracketedPaste).toBe(false)
  })

  it('gives codex longer quiet thresholds than claude (to clear its ~1s boot spinner)', () => {
    expect(cliReadiness('codex').revealQuietMs).toBeGreaterThan(cliReadiness('claude').revealQuietMs)
    expect(cliReadiness('codex').stableReadyMs).toBeGreaterThan(cliReadiness('claude').stableReadyMs)
    // Must clear a ~1s spinner tick with margin, or the mask tears down mid-boot.
    expect(cliReadiness('codex').revealQuietMs).toBeGreaterThan(1000)
    expect(cliReadiness('codex').stableReadyMs).toBeGreaterThan(1000)
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

  it('does NOT settle codex on a sub-second pause between boot-spinner ticks', () => {
    // 900ms quiet would have torn the mask down mid-boot; codex needs >1s.
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: 'Starting MCP servers', sawData: true, quietMs: 950, elapsedMs: 4000 })).toBe(false)
  })

  it('marks codex ready once output is quiet past its threshold (a real post-boot pause)', () => {
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: 'banner', sawData: true, quietMs: 1700, elapsedMs: 4000 })).toBe(true)
  })

  it('marks a default CLI ready after the standard quiet window', () => {
    expect(shouldMarkLaunchReady({ cli: 'coco', recentOutput: 'startup banner', sawData: true, quietMs: 901, elapsedMs: 1200 })).toBe(true)
  })

  it('has a fallback for CLIs that never print a ready-ish signal', () => {
    expect(shouldMarkLaunchReady({ cli: 'codex', recentOutput: '', sawData: false, quietMs: 0, elapsedMs: 30_000 })).toBe(true)
  })
})

describe('shouldRevealLaunch', () => {
  it('reveals claude on a brief quiet (early HITL surfaces fast)', () => {
    expect(shouldRevealLaunch({ cli: 'claude', sawData: true, quietMs: 400 })).toBe(true)
  })

  it('does not reveal codex on a sub-second boot-spinner gap', () => {
    expect(shouldRevealLaunch({ cli: 'codex', sawData: true, quietMs: 900 })).toBe(false)
  })

  it('reveals codex once it is quiet past its (longer) reveal window', () => {
    expect(shouldRevealLaunch({ cli: 'codex', sawData: true, quietMs: 1300 })).toBe(true)
  })

  it('does not reveal before any output has arrived', () => {
    expect(shouldRevealLaunch({ cli: 'claude', sawData: false, quietMs: 5000 })).toBe(false)
  })
})
