import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import { ActivityHub, hasVisibleOutput, type ActivityEvent, type HoldRunning } from './activity'
import { currentDocStore } from '../data/docstore'

/**
 * A live agent process, decoupled from any viewer. The pty keeps running regardless of how many
 * WebSockets are attached (zero is fine), buffering recent output so a (re)attaching viewer can
 * replay the scrollback. This is the tmux model: the process is persistent; sockets are just views.
 */
interface Entry {
  key: string
  pty: IPty
  chunks: string[]   // ring buffer of raw pty output (ANSI included)
  bytes: number
  attached: Set<WebSocket>
  exited: boolean
  quietUntil: number   // ignore output as activity until this time (a Berth-initiated resize repaint)
}

const MAX_BUFFER_BYTES = 512 * 1024   // ~scrollback kept per session for replay
const RESIZE_QUIET_MS = 500           // a resize triggers a full repaint — not a turn, so don't spin
const KILL_GRACE_MS = 2000            // SIGTERM → wait this long → SIGKILL (escalation for live kills)
const registry = new Map<string, Entry>()

/**
 * Signal an agent's ENTIRE process group, not just the top pty pid. node-pty `setsid()`s the child,
 * so the agent leads its own process group (pgid == pid); the negative-pid send reaches the agent
 * AND every descendant it spawned (MCP servers, sub-node processes, ripgrep, language servers).
 * `entry.pty.kill()` alone sends SIGHUP to the single leader pid — which agents like claude (a Node
 * TUI) may trap, and which never reaches the descendant tree → orphans reparented to launchd. That
 * was the zombie-session leak. Falls back to the single-pid kill if the group send fails (pid gone,
 * or a test fake with no real pid).
 */
function signalTree(pty: IPty, signal: NodeJS.Signals): void {
  const pid = pty.pid
  // CRUCIAL: never send to pid 0 / NaN — `process.kill(-0)` targets OUR OWN process group (it would
  // take down the Berth server itself). Real agent pids are always positive; anything else falls
  // through to the single-pid kill.
  if (typeof pid === 'number' && pid > 0) {
    try { process.kill(-pid, signal); return } catch {}
  }
  try { pty.kill(signal) } catch {}
}

/**
 * Graceful terminate for the RUNNING server (■ kill button, pre-spawn cleanup, rekey clash):
 * SIGTERM the group now, then SIGKILL it after a grace window if anything ignored SIGTERM. NOT for
 * shutdown — the exit handler runs synchronously and can't wait for this timer (see killAllPtys).
 */
function terminateTree(pty: IPty): void {
  signalTree(pty, 'SIGTERM')
  const pid = pty.pid
  if (typeof pid !== 'number' || pid <= 0) return   // same own-group guard as signalTree
  const t = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch {} }, KILL_GRACE_MS)
  t.unref()   // a pending escalation must never hold the process open
}

/**
 * Per-session live activity (running ⇄ settled), inferred from the byte stream this registry already
 * sees for every session regardless of viewers. This is what drives the in-list spinner / red dot.
 */
export const IDLE_MS = 1200   // silence after which a running session is considered settled
const activity = new ActivityHub({ idleMs: IDLE_MS })
export function subscribeActivity(cb: (e: ActivityEvent) => void): () => void { return activity.subscribe(cb) }
export function snapshotActivity(): { sessionId: string; state: 'running' | 'settled' }[] { return activity.snapshot() }

export function hasLivePty(key: string): boolean {
  const e = registry.get(key)
  return !!e && !e.exited
}

export function liveCount(): number { return registry.size }

/**
 * Register a freshly-spawned pty under `key`. Starts buffering output + broadcasting to viewers.
 * `opts.running` marks a turn as already underway (a fresh launch with an auto-fired prompt); a
 * passive resume/open-to-view omits it, so opening a session does NOT light the spinner.
 */
export function registerPty(key: string, pty: IPty, opts?: { running?: boolean; holdRunning?: HoldRunning; onExit?: () => void }): void {
  killPty(key)   // never leak a previous pty for the same key
  const entry: Entry = { key, pty, chunks: [], bytes: 0, attached: new Set(), exited: false, quietUntil: 0 }
  registry.set(key, entry)
  activity.register(key, opts)
  pty.onData(d => {
    entry.chunks.push(d)
    entry.bytes += d.length
    while (entry.bytes > MAX_BUFFER_BYTES && entry.chunks.length > 1) entry.bytes -= entry.chunks.shift()!.length
    for (const ws of entry.attached) { try { ws.send(d) } catch {} }
    // Count output as turn activity unless it's noise: an idle cursor-repaint (no visible content)
    // or the full repaint a Berth-initiated resize just triggered (within the quiet window).
    if (hasVisibleOutput(d) && Date.now() >= entry.quietUntil) activity.data(key)
  })
  pty.onExit(() => {
    entry.exited = true
    for (const ws of entry.attached) { try { ws.send('\r\n[berth] session ended.\r\n') } catch {} ; try { ws.close() } catch {} }
    registry.delete(key)
    activity.exit(key)
    try { opts?.onExit?.() } catch {}   // mechanical context-log rotation (§7 Phase 1); never throws into pty
  })
}

/**
 * Attach a viewer to the live pty for `key`: replay the scrollback, then stream output and accept
 * input/resize. When the socket closes the viewer DETACHES — the pty keeps running. A `{t:'kill'}`
 * message ends the session for real. Returns false if there is no live pty for `key`.
 */
export function attachViewer(key: string, ws: WebSocket): boolean {
  const entry = registry.get(key)
  if (!entry || entry.exited) return false
  const replay = entry.chunks.join('')
  if (replay) { try { ws.send(replay) } catch {} }
  entry.attached.add(ws)
  ws.on('message', raw => {
    let msg: any
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.t === 'i' && typeof msg.d === 'string') { entry.pty.write(msg.d); activity.input(key, msg.d) }
    else if (msg.t === 'img' && typeof msg.d === 'string') {
      // Image-paste bypass: the terminal stream only ever carries text, so a pasted image can never
      // reach the CLI via `t:'i'`. The client sends the base64 image here instead; we persist it and
      // write its on-disk path into the pty — byte-for-byte identical to the user dragging the file
      // into a macOS terminal, which is exactly the input claude/codex/coco image detection reads.
      const saved = currentDocStore().saveAttachment(msg.d, typeof msg.name === 'string' ? msg.name : 'paste')
      if (saved) {
        const injected = saved.abs.replace(/ /g, '\\ ') + ' '   // escape spaces (drag-drop convention)
        entry.pty.write(injected)
        activity.input(key, injected)
      }
    }
    else if (msg.t === 'r' && msg.c > 0 && msg.r > 0) { try { entry.pty.resize(msg.c, msg.r) } catch {} ; entry.quietUntil = Date.now() + RESIZE_QUIET_MS }
    else if (msg.t === 'kill') killPty(key)
  })
  ws.on('close', () => { entry.attached.delete(ws) })   // detach only — pty stays alive
  return true
}

/** Explicitly end a session: kill the pty and drop it (closing any viewers). */
export function killPty(key: string): void {
  const entry = registry.get(key)
  if (!entry) return
  registry.delete(key)
  terminateTree(entry.pty)
  for (const ws of entry.attached) { try { ws.close() } catch {} }
  activity.exit(key)
}

/** Kill every live pty and empty the registry. Used on server shutdown so PTYs (and the whole
 *  process tree below each — MCP servers, sub-node, etc.) aren't reparented to launchd when Berth
 *  exits. The shutdown handler runs synchronously and then `process.exit()`s, so it CANNOT wait for
 *  a SIGTERM grace timer — we go straight to a synchronous group SIGKILL. Correctness (zero orphans)
 *  beats graceful agent teardown here; that's the whole reason this leak existed. */
export function killAllPtys(): void {
  for (const key of [...registry.keys()]) {
    const entry = registry.get(key)!
    registry.delete(key)
    signalTree(entry.pty, 'SIGKILL')
    for (const ws of entry.attached) { try { ws.close() } catch {} }
    activity.exit(key)
  }
}

/** Move a live pty to a new key (e.g. a codex session bound to its real id by reconcile). */
export function rekeyPty(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return
  const entry = registry.get(oldKey)
  if (!entry) return
  registry.delete(oldKey)
  const clash = registry.get(newKey)
  if (clash && clash !== entry) { registry.delete(newKey); terminateTree(clash.pty) }
  entry.key = newKey
  registry.set(newKey, entry)
  activity.rekey(oldKey, newKey)
}
