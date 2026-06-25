import type { IPty } from 'node-pty'
import { hasVisibleOutput } from './activity'
import { currentDocStore } from '../data/docstore'
import type { Inbound, SessionDriver } from './session-driver'
import { DEFAULT_PTY_REPLAY_BYTES, PtySpool } from './pty-spool'

const MAX_BUFFER_BYTES = 2 * 1024 * 1024   // ~scrollback kept per session for replay on (re)attach
const RESIZE_QUIET_MS = 500           // a resize triggers a full repaint — not a turn, so don't spin
const FAST_FAIL_MS = 2500             // a process that exits this fast almost certainly failed to START

/**
 * Model A driver: wraps a node-pty so the browser receives raw bytes and renders them in xterm. This
 * is the original registry behavior, extracted verbatim behind the SessionDriver seam — raw output
 * ring buffer, visible-output activity gating, and the resize-quiet window all live here now.
 */
export class TuiDriver implements SessionDriver {
  readonly mode = 'tui' as const
  private chunks: string[] = []   // ring buffer of raw pty output (ANSI included)
  private bytes = 0
  private quietUntil = 0          // ignore output as activity until this time (Berth-initiated resize repaint)
  private frameCb: (s: string) => void = () => {}
  private exitCb: () => void = () => {}
  private activityCb: () => void = () => {}
  private spool: PtySpool

  private startedAt = Date.now()
  private sawVisible = false
  private retried = false
  private respawn?: () => IPty | null

  // `respawn` (TUI fresh launch only) is the reactive last-resort retry: if the process fast-fails,
  // we re-spawn ONCE with a minimal/most-compatible arg set (see launchFresh minimal) and keep going
  // on the SAME driver, so the registry and attached viewers never see a dead session — they just see
  // a brief retry notice then the bare session. One retry max (`retried`) so a genuinely-broken
  // binary can't loop. After a successful retry, normal fast-fail no longer applies.
  constructor(private pty: IPty, key: string, opts?: { respawn?: () => IPty | null }) {
    this.spool = new PtySpool(key)
    this.respawn = opts?.respawn
    this.bindPty(pty)
  }

  private bindPty(pty: IPty): void {
    this.pty = pty
    this.startedAt = Date.now()
    this.sawVisible = false
    pty.onData((d) => {
      this.spool.append(d)
      this.chunks.push(d)
      this.bytes += d.length
      while (this.bytes > MAX_BUFFER_BYTES && this.chunks.length > 1) this.bytes -= this.chunks.shift()!.length
      this.frameCb(d)
      // Count output as turn activity unless it's noise: an idle cursor-repaint (no visible content)
      // or the full repaint a Berth-initiated resize just triggered (within the quiet window).
      if (hasVisibleOutput(d)) {
        this.sawVisible = true
        if (Date.now() >= this.quietUntil) this.activityCb()
      }
    })
    pty.onExit((e) => {
      const code = e?.exitCode ?? 0
      if (this.shouldRetry(code)) {
        this.retried = true
        let next: IPty | null = null
        try { next = this.respawn!() } catch { next = null }
        if (next) {
          try { this.frameCb('\r\n[berth] startup failed — retrying without advanced options…\r\n') } catch {}
          this.bindPty(next)
          return
        }
      }
      try { this.frameCb(this.exitMessage(code)) } catch {}
      this.spool.close()
      this.exitCb()
    })
  }

  private shouldRetry(exitCode: number): boolean {
    if (this.retried || !this.respawn) return false
    // Same signal as the diagnostic: died fast, and either nonzero or never showed real output.
    return Date.now() - this.startedAt < FAST_FAIL_MS && (exitCode !== 0 || !this.sawVisible)
  }

  // A process that dies within FAST_FAIL_MS of spawn never really started — almost always a startup
  // failure (an unsupported CLI flag that the binary rejected, a version mismatch, a missing auth).
  // Flag-gating (src/pty/flag-gate.ts) drops the flags we know are version-sensitive, so this is the
  // backstop for everything else: surface a clear diagnostic instead of a bland "session ended" so a
  // dead session isn't mistaken for one that simply finished. The CLI's own error text is in the
  // output above (the arg parser prints to stderr, which the PTY merges) — we just frame it.
  private exitMessage(exitCode: number): string {
    const fast = Date.now() - this.startedAt < FAST_FAIL_MS
    if (fast && (exitCode !== 0 || !this.sawVisible)) {
      return `\r\n[berth] the agent exited during startup (code ${exitCode}). This usually means an unsupported CLI flag or a version/auth issue — check the output above, or update the CLI.\r\n`
    }
    return '\r\n[berth] session ended.\r\n'
  }

  get pid(): number | undefined { return this.pty.pid }
  kill(signal: NodeJS.Signals): void { try { this.pty.kill(signal) } catch {} }
  onFrame(cb: (s: string) => void): void { this.frameCb = cb }
  onExit(cb: () => void): void { this.exitCb = cb }
  onActivity(cb: () => void): void { this.activityCb = cb }
  snapshot(maxBytes = DEFAULT_PTY_REPLAY_BYTES): string[] {
    const persisted = this.spool.snapshot(maxBytes)
    if (persisted) return [persisted]
    const j = this.chunks.join('')
    return j ? [j] : []
  }
  rekey(key: string): void { this.spool.rekey(key) }

  send(msg: Inbound): void {
    if (msg.t === 'i' && typeof msg.d === 'string') {
      this.pty.write(msg.d)
    } else if (msg.t === 'img' && typeof msg.d === 'string') {
      // Image-paste bypass: the terminal stream only carries text, so a pasted image can never reach
      // the CLI via `t:'i'`. Persist it and bracket-paste its on-disk path into the pty, matching the
      // signal Claude/Codex image detection expects from terminal image paste/drop integrations.
      const saved = currentDocStore().saveAttachment(msg.d, typeof msg.name === 'string' ? msg.name : 'paste')
      if (saved) this.pty.write(`\x1b[200~${saved.abs.replace(/ /g, '\\ ')}\x1b[201~`)
    } else if (msg.t === 'r' && typeof msg.c === 'number' && typeof msg.r === 'number' && msg.c > 0 && msg.r > 0) {
      try { this.pty.resize(msg.c, msg.r) } catch {}
      this.quietUntil = Date.now() + RESIZE_QUIET_MS
    }
  }
}
