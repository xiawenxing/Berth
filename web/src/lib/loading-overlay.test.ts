import { describe, it, expect } from 'vitest'
import { shouldShowLoadingOverlay, LOADING_OVERLAY_DELAY_MS } from './loading-overlay'

describe('shouldShowLoadingOverlay', () => {
  it('stays hidden before the anti-flash delay elapses', () => {
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: 0 })).toBe(false)
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: LOADING_OVERLAY_DELAY_MS - 1 })).toBe(false)
  })

  it('shows once the delay elapses with no data yet (cold open)', () => {
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: LOADING_OVERLAY_DELAY_MS })).toBe(true)
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: 5000 })).toBe(true)
  })

  it('never shows once data has arrived (fast path stays flash-free)', () => {
    expect(shouldShowLoadingOverlay({ hasData: true, elapsedMs: 0 })).toBe(false)
    expect(shouldShowLoadingOverlay({ hasData: true, elapsedMs: 10000 })).toBe(false)
  })

  it('honors a custom delay', () => {
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: 80, delayMs: 100 })).toBe(false)
    expect(shouldShowLoadingOverlay({ hasData: false, elapsedMs: 120, delayMs: 100 })).toBe(true)
  })
})
