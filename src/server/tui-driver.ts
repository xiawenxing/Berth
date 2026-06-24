import type { IPty } from 'node-pty'
import { hasVisibleOutput } from './activity'
import { currentDocStore } from '../data/docstore'
import type { Inbound, SessionDriver } from './session-driver'
import { DEFAULT_PTY_REPLAY_BYTES, PtySpool } from './pty-spool'

const MAX_BUFFER_BYTES = 2 * 1024 * 1024   // ~scrollback kept per session for replay on (re)attach
const RESIZE_QUIET_MS = 500           // a resize triggers a full repaint — not a turn, so don't spin

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

  constructor(private pty: IPty, key: string) {
    this.spool = new PtySpool(key)
    pty.onData((d) => {
      this.spool.append(d)
      this.chunks.push(d)
      this.bytes += d.length
      while (this.bytes > MAX_BUFFER_BYTES && this.chunks.length > 1) this.bytes -= this.chunks.shift()!.length
      this.frameCb(d)
      // Count output as turn activity unless it's noise: an idle cursor-repaint (no visible content)
      // or the full repaint a Berth-initiated resize just triggered (within the quiet window).
      if (hasVisibleOutput(d) && Date.now() >= this.quietUntil) this.activityCb()
    })
    pty.onExit(() => {
      try { this.frameCb('\r\n[berth] session ended.\r\n') } catch {}
      this.spool.close()
      this.exitCb()
    })
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
