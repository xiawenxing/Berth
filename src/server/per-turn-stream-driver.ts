import type { ChatFrame, ChatReducer } from '../agent/normalize/chat-model'
import type { Inbound, SessionDriver } from './session-driver'
import type { ChildLike } from './stream-json-driver'

/** Spawns one turn's process. `resumeId` is null for the first (fresh) turn, else the session id to resume. */
export type SpawnTurn = (prompt: string, resumeId: string | null) => ChildLike

/**
 * Model B driver for CLIs that are single-turn-then-exit (codex `exec --json`, coco `--print
 * --output-format=stream-json`): each user turn spawns a fresh process (`exec` for the first turn,
 * `exec resume`/`--resume` thereafter), whose NDJSON output feeds one accumulating reducer. Unlike the
 * persistent StreamJsonDriver (claude), there is no long-lived process — the registry session stays
 * alive between turns with no child running, so a child exit ends a TURN, not the session.
 */
export class PerTurnStreamDriver implements SessionDriver {
  readonly mode = 'stream' as const
  private frameCb: (s: string) => void = () => {}
  private exitCb: () => void = () => {}
  private activityCb: () => void = () => {}
  private active: ChildLike | null = null
  private buf = ''
  private sessionEmitted = false

  constructor(private reducer: ChatReducer, private spawnTurn: SpawnTurn, opts?: { initialPrompt?: string }) {
    if (opts?.initialPrompt) this.startTurn(opts.initialPrompt)
  }

  get pid(): number | undefined { return this.active?.pid }
  kill(signal: NodeJS.Signals): void { try { this.active?.kill(signal) } catch {} }
  onFrame(cb: (s: string) => void): void { this.frameCb = cb }
  onExit(cb: () => void): void { this.exitCb = cb }   // only fired by the registry on explicit kill; a child exit is just turn-done
  onActivity(cb: () => void): void { this.activityCb = cb }

  snapshot(): string[] {
    return [this.serialize({ type: 'snapshot', turns: this.reducer.snapshot() })]
  }

  send(msg: Inbound): void {
    if (msg.t === 'turn' && typeof msg.text === 'string') this.startTurn(msg.text)
    else if (msg.t === 'interrupt') { try { this.active?.kill('SIGTERM') } catch {} }
  }

  private startTurn(prompt: string): void {
    if (this.active) return   // one turn at a time (the composer disables submit while busy)
    const userTurn = this.reducer.addUserTurn(prompt)
    this.emit({ type: 'turn', turn: userTurn })
    this.activityCb()
    this.buf = ''
    const resumeId = this.reducer.sessionId ?? null
    const child = this.spawnTurn(prompt, resumeId)
    this.active = child
    child.stdout?.on('data', (d) => this.onStdout(d.toString()))
    child.on('exit', () => { if (this.active === child) this.active = null })
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
      const turn = this.reducer.ingest(obj)
      if (!this.sessionEmitted && this.reducer.sessionId) {
        this.sessionEmitted = true
        this.emit({ type: 'session', sessionId: this.reducer.sessionId, model: this.reducer.model })
      }
      if (turn) { this.emit({ type: 'turn', turn }); this.activityCb() }
    }
  }

  private emit(frame: ChatFrame): void { this.frameCb(this.serialize(frame)) }
  private serialize(frame: ChatFrame): string { return JSON.stringify(frame) }
}
