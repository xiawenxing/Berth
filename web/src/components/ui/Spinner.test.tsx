import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spinner } from './Spinner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Spinner', () => {
  // Regression: a running-session row re-renders on every /status `act` WS message (live.rev bump).
  // The spinner read performance.now() on every render and wrote it into inline animationDelay, so
  // each re-render re-seeded the CSS rotation phase and the spinner visibly jumped ("闪动跳动").
  // Its rotation phase must be locked at mount and stay put across re-renders.
  it('keeps animationDelay stable across re-renders', async () => {
    // Wall clock advances 137ms between the two renders, as it would under live activity.
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValue(500)

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<Spinner />)
      })
      const first = (host.querySelector('svg') as SVGElement).style.animationDelay
      expect(first).not.toBe('')

      nowSpy.mockReturnValue(637)
      await act(async () => {
        root.render(<Spinner />)
      })
      const second = (host.querySelector('svg') as SVGElement).style.animationDelay

      expect(second).toBe(first)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
