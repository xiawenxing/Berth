import { randomUUID } from 'node:crypto'
import { ClaudeReducer } from '../agent/normalize/claude-reducer'
import type { ChatFrame, Clock } from '../agent/normalize/chat-model'
import type { Inbound, SessionDriver } from './session-driver'
import { prepareStreamTurn, type TurnImage } from './stream-turn'

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
  private seenClientTurnIds = new Set<string>()
  private inFlight = false   // a turn was written to stdin and no `result` line has closed it yet

  constructor(private child: ChildLike, opts?: { initialPrompt?: string; clock?: Clock }) {
    this.reducer = new ClaudeReducer(opts?.clock ?? (() => Math.floor(Date.now() / 1000)))
    this.child.stdout?.on('data', (d) => this.onStdout(d.toString()))
    this.child.stderr?.on('data', (d) => this.onStderr(d.toString()))
    this.child.on('exit', () => { try { this.exitCb() } catch {} })
    if (opts?.initialPrompt) this.sendUserTurn(opts.initialPrompt)
  }

  get pid(): number | undefined { return this.child.pid }
  /** A turn is in flight from submission until the closing `result` line — through the silent
   *  thinking gap and any inter-tool pauses. The registry uses this as the activity holdRunning guard. */
  turnActive(): boolean { return this.inFlight }
  kill(signal: NodeJS.Signals): void { try { this.child.kill(signal) } catch {} }
  onFrame(cb: (s: string) => void): void { this.frameCb = cb }
  onExit(cb: () => void): void { this.exitCb = cb }
  onActivity(cb: () => void): void { this.activityCb = cb }

  snapshot(): string[] {
    return [this.serialize({ type: 'snapshot', turns: this.reducer.snapshot() })]
  }

  send(msg: Inbound): void {
    if (msg.t === 'turn' && typeof msg.text === 'string') {
      const images = Array.isArray(msg.images) ? msg.images.filter((image: any): image is TurnImage => !!image && typeof image.dataUrl === 'string') : undefined
      this.sendUserTurn(msg.text, typeof msg.clientTurnId === 'string' ? msg.clientTurnId : undefined, images)
    }
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

  private onStderr(chunk: string): void {
    const text = chunk.trim()
    if (!text) return
    this.emit({ type: 'error', message: text })
    this.activityCb()
  }

  private ingest(obj: any): void {
    const turn = this.reducer.ingest(obj)
    if (obj?.type === 'result') this.inFlight = false   // turn closed — release the activity hold
    if (!this.sessionEmitted && this.reducer.sessionId) {
      this.sessionEmitted = true
      this.emit({ type: 'session', sessionId: this.reducer.sessionId, model: this.reducer.model })
    }
    if (turn) { this.emit({ type: 'turn', turn }); this.activityCb() }
  }

  private sendUserTurn(text: string, clientTurnId?: string, images?: TurnImage[]): void {
    if (clientTurnId) {
      if (this.seenClientTurnIds.has(clientTurnId)) return
      this.seenClientTurnIds.add(clientTurnId)
    }
    const prepared = prepareStreamTurn(text, images)
    if (!prepared.agentText) return
    this.inFlight = true   // turn begins now; cleared by the `result` line in ingest()
    const turn = this.reducer.addUserTurn(prepared.displayText, clientTurnId)
    this.emit({ type: 'turn', turn })
    this.activityCb()
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: prepared.agentText }, parent_tool_use_id: null })
    try { this.child.stdin?.write(msg + '\n') } catch {}
  }

  private sendInterrupt(): void {
    const req = JSON.stringify({ type: 'control_request', request_id: `req_${++this.interruptSeq}_${randomUUID()}`, request: { subtype: 'interrupt' } })
    try { this.child.stdin?.write(req + '\n') } catch {}
  }

  private emit(frame: ChatFrame): void { this.frameCb(this.serialize(frame)) }
  private serialize(frame: ChatFrame): string { return JSON.stringify(frame) }
}
