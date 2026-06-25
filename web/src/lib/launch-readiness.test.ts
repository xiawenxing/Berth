import { describe, expect, it } from 'vitest'
import { BRACKETED_PASTE_READY, shouldMarkLaunchReady } from './launch-readiness'

describe('shouldMarkLaunchReady', () => {
  it('treats Claude bracketed-paste enable as a readiness signal', () => {
    expect(shouldMarkLaunchReady({
      cli: 'claude',
      recentOutput: `banner ${BRACKETED_PASTE_READY}`,
      sawData: true,
      quietMs: 0,
      elapsedMs: 100,
    })).toBe(true)
  })

  it('does not trust the bracketed-paste marker for non-Claude launches', () => {
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
      cli: 'coco',
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
