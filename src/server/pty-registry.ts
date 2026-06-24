import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import { ActivityHub, type ActivityEvent, type HoldRunning } from './activity'
import type { Inbound, SessionDriver } from './session-driver'
import { TuiDriver } from './tui-driver'

/**
 * A live agent process, decoupled from any viewer. The driver keeps running regardless of how many
 * WebSockets are attached (zero is fine), buffering recent output so a (re)attaching viewer can
 * replay the scrollback. This is the tmux model: the process is persistent; sockets are just views.
 *
 * The `driver` is the Model A/B seam (TuiDriver = raw bytes / StreamJsonDriver = chat events). The
 * registry treats it opaquely — buffer/fan-out/group-kill only need serialized frames + pid + kill.
 */
interface Entry {
  key: string
  driver: SessionDriver
  attached: Set<WebSocket>
  exited: boolean
}

const KILL_GRACE_MS = 2000            // SIGTERM → wait this long → SIGKILL (escalation for live kills)
const registry = new Map<string, Entry>()

/**
 * Signal an agent's ENTIRE process group, not just the top leader pid. node-pty `setsid()`s the
 * child, and StreamJsonDriver spawns `detached:true`, so the agent leads its own process group
 * (pgid == pid); the negative-pid send reaches the agent AND every descendant it spawned (MCP
 * servers, sub-node processes, ripgrep, language servers). `driver.kill()` alone sends the signal to
 * the single leader pid — which a Node TUI may trap, and which never reaches the descendant tree →
 * orphans reparented to launchd. That was the zombie-session leak. Falls back to the single-pid kill
 * if the group send fails (pid gone, or a test fake with no real pid).
 */
function signalTree(driver: SessionDriver, signal: NodeJS.Signals): void {
  const pid = driver.pid
  // CRUCIAL: never send to pid 0 / NaN — `process.kill(-0)` targets OUR OWN process group (it would
  // take down the Berth server itself). Real agent pids are always positive; anything else falls
  // through to the single-pid kill.
  if (typeof pid === 'number' && pid > 0) {
    try { process.kill(-pid, signal); return } catch {}
  }
  driver.kill(signal)
}

/**
 * Graceful terminate for the RUNNING server (■ kill button, pre-spawn cleanup, rekey clash):
 * SIGTERM the group now, then SIGKILL it after a grace window if anything ignored SIGTERM. NOT for
 * shutdown — the exit handler runs synchronously and can't wait for this timer (see killAllPtys).
 */
function terminateTree(driver: SessionDriver): void {
  signalTree(driver, 'SIGTERM')
  const pid = driver.pid
  if (typeof pid !== 'number' || pid <= 0) return   // same own-group guard as signalTree
  const t = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch {} }, KILL_GRACE_MS)
  t.unref()   // a pending escalation must never hold the process open
}

/**
 * Per-session live activity (running ⇄ settled), inferred from the frames this registry sees for
 * every session regardless of viewers. This is what drives the in-list spinner / red dot.
 */
export const IDLE_MS = 1200   // silence after which a running session is considered settled
const activity = new ActivityHub({ idleMs: IDLE_MS })
export function subscribeActivity(cb: (e: ActivityEvent) => void): () => void { return activity.subscribe(cb) }
export function snapshotActivity(): { sessionId: string; state: 'running' | 'settled' }[] { return activity.snapshot() }

export function hasLivePty(key: string): boolean {
  const e = registry.get(key)
  return !!e && !e.exited
}

/** The render mode of the live driver for `key` ('tui' | 'stream'), or undefined if none is live.
 *  Used to enforce one-mode-per-session: an attach requesting a different mode kills + respawns. */
export function liveDriverMode(key: string): 'tui' | 'stream' | undefined {
  const e = registry.get(key)
  return e && !e.exited ? e.driver.mode : undefined
}

export function liveCount(): number { return registry.size }

/**
 * Register a freshly-spawned SESSION (any driver) under `key`. Starts buffering output +
 * broadcasting to viewers. `opts.running` marks a turn as already underway (a fresh launch with an
 * auto-fired prompt); a passive resume/open-to-view omits it, so opening a session does NOT light
 * the spinner.
 */
export function registerSession(key: string, driver: SessionDriver, opts?: { running?: boolean; holdRunning?: HoldRunning; onExit?: () => void }): void {
  killPty(key)   // never leak a previous session for the same key
  const entry: Entry = { key, driver, attached: new Set(), exited: false }
  registry.set(key, entry)
  activity.register(key, opts)
  driver.onFrame((s) => { for (const ws of entry.attached) { try { ws.send(s) } catch {} } })
  driver.onActivity(() => activity.data(key))
  driver.onExit(() => {
    entry.exited = true
    for (const ws of entry.attached) { try { ws.close() } catch {} }
    registry.delete(key)
    activity.exit(key)
    try { opts?.onExit?.() } catch {}   // mechanical context-log rotation (§7 Phase 1); never throws into the driver
  })
}

/**
 * Back-compat shim: register a node-pty (Model A) by wrapping it in a TuiDriver. Existing callers and
 * tests pass an IPty here; new Model B callers use registerSession with a StreamJsonDriver.
 */
export function registerPty(key: string, pty: IPty, opts?: { running?: boolean; holdRunning?: HoldRunning; onExit?: () => void }): void {
  registerSession(key, new TuiDriver(pty, key), opts)
}

/**
 * Attach a viewer to the live session for `key`: replay the scrollback/snapshot, then stream output
 * and accept input. When the socket closes the viewer DETACHES — the session keeps running. A
 * `{t:'kill'}` message ends the session for real. Returns false if there is no live session for `key`.
 */
export function attachViewer(key: string, ws: WebSocket, opts?: { replayBytes?: number }): boolean {
  const entry = registry.get(key)
  if (!entry || entry.exited) return false
  for (const frame of entry.driver.snapshot(opts?.replayBytes)) { try { ws.send(frame) } catch {} }
  entry.attached.add(ws)
  ws.on('message', (raw) => {
    let msg: Inbound
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.t === 'kill') { killPty(key); return }
    // Activity wiring stays in the registry (it owns the key): a keystroke or a submitted turn is a
    // turn signal; a resize / image paste is not. The driver does the actual I/O.
    if (msg.t === 'i' && typeof msg.d === 'string') activity.input(key, msg.d)
    else if (msg.t === 'turn') activity.input(key, '\r')   // a submitted user turn starts a turn (like Enter)
    entry.driver.send(msg)
  })
  ws.on('close', () => { entry.attached.delete(ws) })   // detach only — session stays alive
  return true
}

/** Explicitly end a session: kill the process and drop it (closing any viewers). */
export function killPty(key: string): void {
  const entry = registry.get(key)
  if (!entry) return
  registry.delete(key)
  terminateTree(entry.driver)
  for (const ws of entry.attached) { try { ws.close() } catch {} }
  activity.exit(key)
}

/** Kill every live session and empty the registry. Used on server shutdown so processes (and the
 *  whole tree below each — MCP servers, sub-node, etc.) aren't reparented to launchd when Berth
 *  exits. The shutdown handler runs synchronously and then `process.exit()`s, so it CANNOT wait for
 *  a SIGTERM grace timer — we go straight to a synchronous group SIGKILL. Correctness (zero orphans)
 *  beats graceful agent teardown here; that's the whole reason this leak existed. */
export function killAllPtys(): void {
  for (const key of [...registry.keys()]) {
    const entry = registry.get(key)!
    registry.delete(key)
    signalTree(entry.driver, 'SIGKILL')
    for (const ws of entry.attached) { try { ws.close() } catch {} }
    activity.exit(key)
  }
}

/** Move a live session to a new key (e.g. a codex session bound to its real id by reconcile). */
export function rekeyPty(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return
  const entry = registry.get(oldKey)
  if (!entry) return
  registry.delete(oldKey)
  const clash = registry.get(newKey)
  if (clash && clash !== entry) { registry.delete(newKey); terminateTree(clash.driver) }
  entry.key = newKey
  try { entry.driver.rekey?.(newKey) } catch {}
  registry.set(newKey, entry)
  activity.rekey(oldKey, newKey)
}
