import { describe, expect, it, vi } from 'vitest'
import { attachWheelReclaim, wheelLines } from './terminal-wheel'

const geom = { rows: 30, viewportHeight: 600 }   // 20px cells

describe('wheelLines', () => {
  it('converts pixel deltas through the cell height, at xterm’s scroll sensitivity', () => {
    // 20px cell, sensitivity 3 → one 20px notch is 3 lines.
    expect(wheelLines({ deltaY: 20, deltaMode: 0 }, geom)).toEqual({ lines: 3, carry: 0 })
    expect(wheelLines({ deltaY: -20, deltaMode: 0 }, geom)).toEqual({ lines: -3, carry: 0 })
  })

  it('accumulates sub-line remainders so trackpad scrolling is smooth, not steppy', () => {
    const a = wheelLines({ deltaY: 4, deltaMode: 0 }, geom)          // 0.6 lines
    expect(a.lines).toBe(0)
    const b = wheelLines({ deltaY: 4, deltaMode: 0 }, geom, a.carry) // 1.2 lines total
    expect(b.lines).toBe(1)
    expect(b.carry).toBeCloseTo(0.2)
  })

  it('takes line and page deltas as they come', () => {
    expect(wheelLines({ deltaY: 2, deltaMode: 1 }, geom)).toEqual({ lines: 6, carry: 0 })
    expect(wheelLines({ deltaY: 1, deltaMode: 2 }, geom)).toEqual({ lines: 90, carry: 0 })
  })

  it('drops events it cannot convert instead of scrolling wildly', () => {
    expect(wheelLines({ deltaY: 0, deltaMode: 0 }, geom, 0.4)).toEqual({ lines: 0, carry: 0.4 })
    // A drawer mid-animation can measure as zero-height; dividing by that cell size is nonsense.
    expect(wheelLines({ deltaY: 20, deltaMode: 0 }, { rows: 30, viewportHeight: 0 })).toEqual({ lines: 0, carry: 0 })
    expect(wheelLines({ deltaY: 20, deltaMode: 0 }, { rows: 0, viewportHeight: 600 })).toEqual({ lines: 0, carry: 0 })
  })
})

// Regression: a session whose CLI opened a full-screen view (Claude Code's `claude agents` manager, its
// background-agent attach client, a pager) became completely unscrollable. Half of that is the mouse
// reporting such a view turns on: xterm then routes the wheel to the CLI INSTEAD of scrolling the
// viewport, and the CLIs in question do nothing with it.
describe('attachWheelReclaim', () => {
  function fakeTerm(mouseTrackingMode: string) {
    let handler: (ev: any) => boolean = () => true
    const scrolled: number[] = []
    const term = {
      rows: 30,
      modes: { mouseTrackingMode },
      scrollLines: (n: number) => scrolled.push(n),
      attachCustomWheelEventHandler: (cb: (ev: any) => boolean) => { handler = cb },
    }
    return { term, scrolled, wheel: (deltaY: number) => handler({ deltaY, deltaMode: 0 }) }
  }
  const host = { clientHeight: 600 } as HTMLElement

  it('leaves the wheel to xterm until the CLI actually captures the mouse', () => {
    const { term, scrolled, wheel } = fakeTerm('none')
    attachWheelReclaim(term as any, host)
    expect(wheel(40)).toBe(true)          // xterm proceeds normally
    expect(scrolled).toEqual([])
  })

  it('scrolls the viewport itself once the CLI holds the mouse, instead of reporting the wheel', () => {
    const { term, scrolled, wheel } = fakeTerm('any')
    attachWheelReclaim(term as any, host)

    expect(wheel(-40)).toBe(false)        // not forwarded to the CLI
    expect(scrolled).toEqual([-6])
    expect(wheel(40)).toBe(false)
    expect(scrolled).toEqual([-6, 6])
  })

  it('reclaims under every mouse-reporting protocol xterm knows', () => {
    for (const mode of ['x10', 'vt200', 'drag', 'any']) {
      const { term, wheel } = fakeTerm(mode)
      attachWheelReclaim(term as any, host)
      expect(wheel(40)).toBe(false)
    }
  })

  it('hands the wheel back after dispose', () => {
    const { term, scrolled, wheel } = fakeTerm('any')
    const dispose = attachWheelReclaim(term as any, host)
    dispose()
    expect(wheel(40)).toBe(true)
    expect(scrolled).toEqual([])
  })

  it('carries sub-line remainders across events', () => {
    const { term, scrolled, wheel } = fakeTerm('any')
    attachWheelReclaim(term as any, host)
    wheel(4)                              // 0.6 lines — nothing yet
    expect(scrolled).toEqual([])
    wheel(4)                              // 1.2 lines total → one line moves
    expect(scrolled).toEqual([1])
  })
})
