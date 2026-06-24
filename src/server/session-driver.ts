/**
 * The pluggable seam between Model A (xterm over raw PTY bytes) and Model B (a chat renderer over a
 * structured stream-json stream). A SessionDriver owns (a) the child process and (b) framing; the
 * registry treats it opaquely — it only buffers + fans out serialized frames and group-kills via
 * pid. TuiDriver (node-pty, raw bytes) and StreamJsonDriver (piped child, ChatFrame JSON) implement it.
 *
 * Mode is a per-spawn rendering choice, NOT a session property: the same session id can be (re)spawned
 * under either driver and both append to the same on-disk jsonl.
 */

export type Inbound =
  | { t: 'i'; d: string }                                              // raw keystrokes (A)
  | { t: 'r'; c: number; r: number }                                   // resize (A)
  | { t: 'img'; d: string; name?: string }                             // image paste (A)
  | { t: 'turn'; text: string; clientTurnId?: string; images?: { name: string; dataUrl: string }[] }  // user turn (B)
  | { t: 'interrupt' }                                                  // cancel current turn (B)
  | { t: 'kill' }                                                       // end session (registry-handled)
  | { t: string;[k: string]: unknown }                                 // tolerate unknown frames

export interface SessionDriver {
  readonly mode: 'tui' | 'stream'
  readonly pid: number | undefined
  /** Single-pid kill (the registry's negative-pid group-kill is the primary path; this is fallback). */
  kill(signal: NodeJS.Signals): void
  /** Register the single broadcast sink (the registry). Each call replaces the prior cb. */
  onFrame(cb: (serialized: string) => void): void
  /** The underlying process exited. */
  onExit(cb: () => void): void
  /** "Made render progress" → the registry maps this to activity.data(key). Fires per outbound frame. */
  onActivity(cb: () => void): void
  /** Inbound frame from a viewer. `t:'kill'` is handled by the registry and never reaches here. */
  send(msg: Inbound): void
  /** Already-serialized frames to replay to a (re)attaching viewer (scrollback for A; a chat snapshot for B). */
  snapshot(maxBytes?: number): string[]
  /** Optional: live sessions may need to move durable sidecars when an intent id becomes a real id. */
  rekey?(key: string): void
}
