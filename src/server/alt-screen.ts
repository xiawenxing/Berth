/**
 * Keep the alternate screen buffer out of the Model A (xterm) viewer stream.
 *
 * WHY THIS EXISTS. A full-screen CLI view — Claude Code's `claude agents` manager, its background-agent
 * attach client, a `vim` opened inside the session — enters the DEC alternate screen buffer with
 * `CSI ?1049h` and leaves it with `CSI ?1049l`. That contract ("I borrow the whole screen and hand it
 * back byte-for-byte") works in a real terminal, which keeps the main buffer's scrollback reachable
 * underneath and lets you scroll it. In Berth's drawer it left the session completely unscrollable, for
 * two compounding reasons:
 *
 *  1. xterm.js's alternate buffer is constructed with `hasScrollback = false`. While it is active the
 *     viewport has literally nothing to scroll, and — unlike iTerm2 / Terminal.app — there is no
 *     affordance for reaching the main buffer's history behind it. The transcript is one buffer away
 *     and unreachable.
 *  2. Berth replays a persisted spool on every (re)attach, and that replay is a byte TAIL
 *     (`pty-spool.ts`), cut at an arbitrary offset. Alt-screen switches in a truncated tail need not be
 *     balanced: a real session was found whose 21 MB spool held two `?1049h` and zero `?1049l`, because
 *     the CLI was killed while a full-screen view was up. Every reopen replayed the enter and never the
 *     exit, so the drawer landed back in the empty alternate buffer — permanently, with nothing the
 *     user could do about it.
 *
 * WHAT WE DO. Viewers never see the alternate screen: the buffer switches are stripped from both the
 * live frames and the replayed snapshot, so a full-screen view paints into the main buffer and the
 * scrollback above it stays reachable. This is the same trade codex already makes explicitly — Berth
 * passes it `--no-alt-screen` (`pty/launch.ts`). Stripping on the way OUT (rather than on the way into
 * the spool) keeps the spool a faithful raw record and heals already-poisoned spools on read.
 *
 * Nothing else in the stream is touched — mouse reporting in particular is passed through untouched, so
 * clicks, drags and hovers stay the CLI's to handle. (The browser reclaims only the WHEEL, and it gates
 * that on xterm's own `modes.mouseTrackingMode`; see web/src/lib/terminal-wheel.ts.)
 */

/** `CSI ? <params> h|l` — a DEC private mode set/reset. Params may be `;`-separated (`CSI ?1049;1002h`). */
const PRIVATE_MODE_RE = /\x1b\[\?([0-9;]*)([hl])/g
/** 1049 = save cursor + alt buffer + clear; 1047 = alt buffer; 47 = the original (pre-DEC) alt buffer. */
const ALT_SCREEN_MODES = new Set(['47', '1047', '1049'])
/**
 * A still-incomplete escape sequence, anchored at BOTH ends. pty chunks split anywhere, so `\x1b[?104`
 * can end one chunk and `9h` start the next — matching per chunk would leak a half sequence to the
 * viewer and miss the switch. Such a tail can only begin at the chunk's last ESC, so we seek there and
 * test from it; a `$`-anchored-only pattern would rescan the whole chunk (measurably: ~1.5 µs vs 30 ns
 * on a 2 KB redraw frame, and it grows with chunk size).
 */
const PARTIAL_TAIL_RE = /^\x1b(?:\[\??[0-9;]*)?$/

/**
 * Remove alternate-buffer switches from `data`, leaving every other byte alone. A multi-param set keeps
 * its non-alt params (`?1049;1002h` → `?1002h`).
 */
export function stripAltScreen(data: string): string {
  if (!data.includes('\x1b')) return data
  return data.replace(PRIVATE_MODE_RE, (whole, params: string, action: string) => {
    const parts = params.split(';')
    const kept = parts.filter(p => !ALT_SCREEN_MODES.has(p))
    if (kept.length === parts.length) return whole   // no alt-screen param here
    return kept.length ? `\x1b[?${kept.join(';')}${action}` : ''
  })
}

/**
 * Chunk-boundary-safe streaming form of {@link stripAltScreen}: feed every pty chunk through `push` and
 * send what it returns to the viewers.
 */
export class AltScreenFilter {
  private carry = ''

  push(data: string): string {
    const s = this.carry ? this.carry + data : data
    const esc = s.lastIndexOf('\x1b')
    const holdFrom = esc >= 0 && PARTIAL_TAIL_RE.test(s.slice(esc)) ? esc : -1
    this.carry = holdFrom < 0 ? '' : s.slice(holdFrom)
    return stripAltScreen(holdFrom < 0 ? s : s.slice(0, holdFrom))
  }

  /** Release any withheld partial sequence (process exit — nothing is coming to complete it). */
  flush(): string {
    const c = this.carry
    this.carry = ''
    return c
  }
}
