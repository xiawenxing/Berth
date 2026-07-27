import type { Terminal as Xterm } from '@xterm/xterm'

/**
 * Give the wheel back to the viewport while the CLI holds the mouse.
 *
 * xterm routes wheel events to a mouse-reporting application INSTEAD of scrolling — the report path
 * replaces the scroll path, so not even shift+wheel gets through. Claude Code's full-screen views turn
 * reporting on and then do nothing with the wheel, which reads as a frozen panel. In a drawer with no
 * other scrollbar the wheel is the only route to the transcript, so we take it back. Clicks, drags and
 * hovers still report — only the wheel is reclaimed.
 *
 * The gate is xterm's own `modes.mouseTrackingMode`, which is the very state xterm consults to decide
 * where a wheel event goes. Reading it (rather than tracking mouse mode ourselves) keeps one source of
 * truth: we can never disagree with the routing decision we're overriding.
 */

/**
 * Lines moved per wheel notch. xterm's default is 1 (one line/tick), which reads as sluggish when
 * skimming scrollback; 3 covers ground without overshooting. Alt-scroll uses xterm's separate
 * fastScrollSensitivity (default 5). Passed to xterm as `scrollSensitivity` AND used by the reclaimed
 * path below, so the two can't drift apart.
 */
export const SCROLL_SENSITIVITY = 3

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

export interface WheelGeometry {
  /** Terminal rows — the page size for DOM_DELTA_PAGE, and the divisor for the cell height. */
  rows: number
  /** Rendered height of the terminal host in px; with `rows` it gives the cell height. */
  viewportHeight: number
}

/**
 * Lines to scroll for `ev`, plus the sub-line remainder to feed back in as `carry` on the next event.
 * Positive scrolls down (toward the newest output), matching `Terminal.scrollLines`. Mirrors what
 * xterm's own Viewport.getLinesScrolled does, fractional carry included, so reclaimed scrolling feels
 * the same as native.
 */
export function wheelLines(
  ev: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
  geom: WheelGeometry,
  carry = 0,
): { lines: number; carry: number } {
  if (!ev.deltaY) return { lines: 0, carry }
  let amount = ev.deltaY * SCROLL_SENSITIVITY
  if (ev.deltaMode === DOM_DELTA_PAGE) {
    amount *= geom.rows
  } else if (ev.deltaMode !== DOM_DELTA_LINE) {
    // Pixels — the trackpad / high-resolution-wheel case. xterm exposes no cell size, so derive it from
    // the host box. A terminal that hasn't been laid out yet measures zero; drop the event rather than
    // divide by it.
    if (geom.rows <= 0 || geom.viewportHeight <= 0) return { lines: 0, carry }
    amount /= geom.viewportHeight / geom.rows
  }
  const total = amount + carry
  const lines = Math.trunc(total)
  return { lines, carry: total - lines }
}

/**
 * Install the reclaim on `term`. `host` is the element xterm was opened into — its height and the
 * terminal's row count give the cell size. Returns a disposer, matching `attachImeComposition`.
 */
export function attachWheelReclaim(term: Xterm, host: HTMLElement): () => void {
  let carry = 0
  let disposed = false
  term.attachCustomWheelEventHandler((ev) => {
    if (disposed || term.modes.mouseTrackingMode === 'none') return true   // xterm's own scrolling is fine
    const next = wheelLines(ev, { rows: term.rows, viewportHeight: host.clientHeight }, carry)
    carry = next.carry
    if (next.lines) term.scrollLines(next.lines)
    return false
  })
  return () => { disposed = true }
}
