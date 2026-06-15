/**
 * Per-session activity FSM, decoupled from node-pty / WebSocket so it is unit-testable.
 *
 * KEY RULE: `running` (the spinner) tracks an active TURN, not mere PTY liveness or raw output.
 * A turn starts only on an explicit signal — a fresh launch with an auto-fired prompt
 * (register {running:true}) or a user-submitted input (Enter). Resuming/opening a session to view
 * it, and a CLI's own idle screen redraws, are NOT turns: they produce a pty and output but must
 * not light the spinner. Output therefore only SUSTAINS a turn that has already started; on a
 * session that hasn't started a turn it is ignored. `settled` (no output for idleMs while running)
 * is how a result OR a wait-for-input both surface — an idle agent emits no pty bytes.
 */

/**
 * Does this pty output chunk contain real, visible content (vs. a pure terminal redraw)? An idle CLI
 * periodically repaints itself — cursor hide/move/show, save/restore — producing escape-only output
 * with no printable characters. Those repaints must NOT count as turn activity, or a session you've
 * already read would flip running→settled every ~10s and the red dot would reappear. Genuine agent
 * output always carries printable text, so we strip ANSI/control sequences and check for any
 * remaining non-whitespace character.
 */
export function hasVisibleOutput(s: string): boolean {
  const stripped = s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')          // CSI sequences (cursor move, SGR, erase…)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')  // OSC sequences (titles, hyperlinks…)
    .replace(/\x1b[\s\S]/g, '')                          // any other ESC + one byte (DECSC/DECRC…)
    .replace(/\x1b/g, '')                                // a trailing lone ESC
    .replace(/[\x00-\x1f\x7f]/g, '')                     // remaining control chars (CR/LF/TAB/BEL…)
  return /\S/.test(stripped)
}

export type ActivityState = 'running' | 'settled' | 'exited'

export type ActivityEvent =
  | { kind: 'state'; sessionId: string; state: ActivityState }
  | { kind: 'rekey'; from: string; to: string }

interface Tracked {
  state: 'running' | 'settled' | 'idle'   // 'idle' = a live pty that hasn't started a turn (resume/open)
  timer: ReturnType<typeof setTimeout> | null
  started: boolean                        // has a turn ever started? gates whether output counts
}

export class ActivityHub {
  private readonly idleMs: number
  private readonly tracked = new Map<string, Tracked>()
  private readonly subs = new Set<(e: ActivityEvent) => void>()

  constructor(opts: { idleMs: number }) {
    this.idleMs = opts.idleMs
  }

  subscribe(cb: (e: ActivityEvent) => void): () => void {
    this.subs.add(cb)
    return () => { this.subs.delete(cb) }
  }

  /** Live running/settled state per session. Idle (resumed, no turn) sessions are NOT included. */
  snapshot(): { sessionId: string; state: 'running' | 'settled' }[] {
    return [...this.tracked.entries()]
      .filter(([, t]) => t.state === 'running' || t.state === 'settled')
      .map(([sessionId, t]) => ({ sessionId, state: t.state as 'running' | 'settled' }))
  }

  /**
   * A pty was registered. `running:true` (a fresh launch with an auto-fired prompt) starts a turn;
   * otherwise it's a passive resume/open-to-view → idle (no spinner until the user acts).
   */
  register(key: string, opts?: { running?: boolean }): void {
    if (opts?.running) this.setRunning(key)
    else if (!this.tracked.has(key)) this.tracked.set(key, { state: 'idle', timer: null, started: false })
  }

  /** Output arrived. It only sustains a turn already in progress — a resume redraw / idle repaint
   *  (the session never started a turn) is ignored, so opening a session never shows a spinner. */
  data(key: string): void {
    const t = this.tracked.get(key)
    if (t && t.started) this.setRunning(key)
  }

  /** Viewer input; an Enter-terminated frame is a user-submitted turn. */
  input(key: string, data: string): void {
    if (data.includes('\r') || data.includes('\n')) this.setRunning(key)
  }

  /** The pty died — drop it and cancel any pending settle. Only sessions that were ever shown emit. */
  exit(key: string): void {
    const t = this.tracked.get(key)
    if (t?.timer) clearTimeout(t.timer)
    const wasShown = !!t && t.state !== 'idle'
    this.tracked.delete(key)
    if (wasShown) this.emit({ kind: 'state', sessionId: key, state: 'exited' })
  }

  /** Move a session's live state to a new key (codex intent id → real session id). */
  rekey(from: string, to: string): void {
    if (from === to) return
    const t = this.tracked.get(from)
    if (!t) return
    this.tracked.delete(from)
    const clash = this.tracked.get(to)
    if (clash?.timer) clearTimeout(clash.timer)
    if (t.timer) clearTimeout(t.timer)          // the old timer's closure emits under `from`
    this.tracked.set(to, t)
    this.emit({ kind: 'rekey', from, to })
    if (t.state === 'running') this.arm(to, t)  // re-arm so settle fires under the new key
  }

  private setRunning(key: string): void {
    let t = this.tracked.get(key)
    if (!t) {
      t = { state: 'running', timer: null, started: true }
      this.tracked.set(key, t)
      this.emit({ kind: 'state', sessionId: key, state: 'running' })
    } else {
      t.started = true
      if (t.state !== 'running') {
        t.state = 'running'
        this.emit({ kind: 'state', sessionId: key, state: 'running' })
      }
    }
    this.arm(key, t)
  }

  private arm(key: string, t: Tracked): void {
    if (t.timer) clearTimeout(t.timer)
    t.timer = setTimeout(() => {
      t.timer = null
      if (t.state === 'running') {
        t.state = 'settled'
        this.emit({ kind: 'state', sessionId: key, state: 'settled' })
      }
    }, this.idleMs)
  }

  private emit(e: ActivityEvent): void {
    for (const cb of this.subs) cb(e)
  }
}
