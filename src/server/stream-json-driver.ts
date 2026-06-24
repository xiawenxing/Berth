import { randomUUID } from 'node:crypto'
import { ClaudeReducer } from '../agent/normalize/claude-reducer'
import type { ChatFrame, Clock } from '../agent/normalize/chat-model'
import type { Inbound, SessionDriver } from './session-driver'

/** The subset of a Node ChildProcess the driver needs (so tests can pass a fake). */
export interface ChildLike {
  pid?: number
  stdout: { on(ev: 'data', cb: (d: Buffer | string) => void): void } | null
  stderr?: { on(ev: 'data', cb: (d: Buffer | string) => void): void } | null
  stdin: { write(s: string): void } | null
  on(ev: 'exit', cb: () => void): void
  kill(signal?: NodeJS.Signals): void
}

/**
 * Model B driver: drives claude in stream-json mode over a piped child process and reduces the NDJSON
 * wire stream into ChatTurn[] (via ClaudeReducer), serving the browser a chat-event stream instead of
 * raw bytes. Inbound `t:'turn'` writes an NDJSON user message to stdin; `t:'interrupt'` writes a
 * control_request. The reducer holds session state, so a (re)attaching viewer gets a full snapshot.
 */
export class StreamJsonDriver implements SessionDriver {
  readonly mode = 'stream' as const
  private reducer: ClaudeReducer
  private frameCb: (s: string) => void = () => {}
  private exitCb: () => void = () => {}
  private activityCb: () => void = () => {}
  private buf = ''
  private interruptSeq = 0
  private sessionEmitted = false

  constructor(private child: ChildLike, opts?: { initialPrompt?: string; clock?: Clock }) {
    this.reducer = new ClaudeReducer(opts?.clock ?? (() => Math.floor(Date.now() / 1000)))
    this.child.stdout?.on('data', (d) => this.onStdout(d.toString()))
    this.child.on('exit', () => { try { this.exitCb() } catch {} })
    if (opts?.initialPrompt) this.sendUserTurn(opts.initialPrompt)
  }

  get pid(): number | undefined { return this.child.pid }
  kill(signal: NodeJS.Signals): void { try { this.child.kill(signal) } catch {} }
  onFrame(cb: (s: string) => void): void { this.frameCb = cb }
  onExit(cb: () => void): void { this.exitCb = cb }
  onActivity(cb: () => void): void { this.activityCb = cb }

  snapshot(): string[] {
    return [this.serialize({ type: 'snapshot', turns: this.reducer.snapshot() })]
  }

  send(msg: Inbound): void {
    if (msg.t === 'turn' && typeof msg.text === 'string') this.sendUserTurn(msg.text, typeof msg.clientTurnId === 'string' ? msg.clientTurnId : undefined)
    else if (msg.t === 'interrupt') this.sendInterrupt()
    // image paste folding + resize are no-ops for stream mode (no TUI, no terminal image channel) in v1.
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      this.ingest(obj)
    }
  }

  private ingest(obj: any): void {
    const turn = this.reducer.ingest(obj)
    if (!this.sessionEmitted && this.reducer.sessionId) {
      this.sessionEmitted = true
      this.emit({ type: 'session', sessionId: this.reducer.sessionId, model: this.reducer.model })
    }
    if (turn) { this.emit({ type: 'turn', turn }); this.activityCb() }
  }

  private sendUserTurn(text: string, clientTurnId?: string): void {
    const turn = this.reducer.addUserTurn(text, clientTurnId)
    this.emit({ type: 'turn', turn })
    this.activityCb()
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    try { this.child.stdin?.write(msg + '\n') } catch {}
  }

  private sendInterrupt(): void {
    const req = JSON.stringify({ type: 'control_request', request_id: `req_${++this.interruptSeq}_${randomUUID()}`, request: { subtype: 'interrupt' } })
    try { this.child.stdin?.write(req + '\n') } catch {}
  }

  private emit(frame: ChatFrame): void { this.frameCb(this.serialize(frame)) }
  private serialize(frame: ChatFrame): string { return JSON.stringify(frame) }
}
