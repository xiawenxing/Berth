import type { ChatFrame, ChatReducer } from '../agent/normalize/chat-model'
import type { Inbound, SessionDriver } from './session-driver'
import type { ChildLike } from './stream-json-driver'
import { logDiag } from './diag'
import { prepareStreamTurn, type TurnImage } from './stream-turn'

/** Spawns one turn's process. `resumeId` is null for the first (fresh) turn, else the session id to resume. */
export type SpawnTurn = (prompt: string, resumeId: string | null) => ChildLike

interface PerTurnDiag {
  cli?: string
  sessionId?: string
  launchToken?: string
}

interface PerTurnOpts {
  initialPrompt?: string
  resumeId?: string
  diag?: PerTurnDiag
}

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
  private pending: string | null = null   // a turn submitted while one was still running (queued)
  private buf = ''
  private sessionEmitted = false
  private firstOutputLogged = false
  private resumeId: string | null
  private seenClientTurnIds = new Set<string>()

  constructor(private reducer: ChatReducer, private spawnTurn: SpawnTurn, private opts?: PerTurnOpts) {
    // resumeId seeds a RESUME open (codex/coco) so the very first turn continues the existing session
    // instead of spawning a fresh one; a fresh launch leaves it null.
    this.resumeId = opts?.resumeId ?? null
    this.diag('driver_start', { hasInitialPrompt: !!opts?.initialPrompt, resumeSeedPresent: !!opts?.resumeId })
    if (opts?.initialPrompt) this.startTurn(opts.initialPrompt)
  }

  get pid(): number | undefined { return this.active?.pid }
  /** A turn is in flight while a turn process is alive OR one is queued behind it (the result→exit
   *  race). The registry uses this as the activity holdRunning guard so the session stays `running`
   *  through the agent's silent thinking gap instead of falsely settling to 停泊 mid-turn. */
  turnActive(): boolean { return this.active !== null || this.pending !== null }
  kill(signal: NodeJS.Signals): void { try { this.active?.kill(signal) } catch {} }
  onFrame(cb: (s: string) => void): void { this.frameCb = cb }
  onExit(cb: () => void): void { this.exitCb = cb }   // only fired by the registry on explicit kill; a child exit is just turn-done
  onActivity(cb: () => void): void { this.activityCb = cb }

  snapshot(): string[] {
    return [this.serialize({ type: 'snapshot', turns: this.reducer.snapshot() })]
  }

  send(msg: Inbound): void {
    if (msg.t === 'turn' && typeof msg.text === 'string') {
      const images = Array.isArray(msg.images) ? msg.images.filter((image: any): image is TurnImage => !!image && typeof image.dataUrl === 'string') : undefined
      this.startTurn(msg.text, typeof msg.clientTurnId === 'string' ? msg.clientTurnId : undefined, images)
    }
    else if (msg.t === 'interrupt') {
      this.diag('interrupt', { active: !!this.active, queued: this.pending !== null })
      try { this.active?.kill('SIGTERM') } catch {}
      this.pending = null
      const turn = this.reducer.interruptCurrent()
      if (turn) this.emit({ type: 'turn', turn })
      this.activityCb()
    }
  }

  private startTurn(prompt: string, clientTurnId?: string, images?: TurnImage[]): void {
    if (clientTurnId) {
      if (this.seenClientTurnIds.has(clientTurnId)) {
        this.diag('dedupe_turn', { clientTurnId })
        return
      }
      this.seenClientTurnIds.add(clientTurnId)
    }
    const prepared = prepareStreamTurn(prompt, images)
    this.diag('prepared', {
      clientTurnId,
      textLen: prompt.length,
      imageCount: images?.length ?? 0,
      agentTextLen: prepared.agentText.length,
      displayTextLen: prepared.displayText.length,
    })
    if (!prepared.agentText) {
      this.diag('empty_turn', { level: 'warn', clientTurnId, textLen: prompt.length, imageCount: images?.length ?? 0 })
      return
    }
    // Always show the user's bubble immediately. If a turn's process is still alive (codex emits its
    // result a beat BEFORE the process exits), QUEUE this turn — dropping it silently was a bug — and
    // fire it when the active child exits.
    const userTurn = this.reducer.addUserTurn(prepared.displayText, clientTurnId)
    this.emit({ type: 'turn', turn: userTurn })
    this.activityCb()
    if (this.active) {
      this.pending = prepared.agentText
      this.diag('queued', { clientTurnId, activePid: this.active.pid })
      return
    }
    this.spawnFor(prepared.agentText)
  }

  private spawnFor(prompt: string): void {
    this.buf = ''
    this.firstOutputLogged = false
    const resumeId = this.reducer.sessionId ?? this.resumeId
    this.diag('spawn_turn', { resumeIdPresent: !!resumeId, promptLen: prompt.length })
    const child = this.spawnTurn(prompt, resumeId)
    this.active = child
    this.diag('spawned', { pid: child.pid, resumeIdPresent: !!resumeId })
    child.stdout?.on('data', (d) => this.onStdout(d.toString()))
    child.stderr?.on('data', (d) => this.onStderr(d.toString()))
    child.on('exit', () => {
      if (this.active !== child) return
      this.active = null
      this.diag('child_exit', { pid: child.pid, queued: this.pending !== null })
      const next = this.pending
      this.pending = null
      if (next !== null) this.spawnFor(next)   // drain a queued turn
    })
  }

  private onStderr(chunk: string): void {
    const text = chunk.trim()
    if (!text) return
    this.diag('stderr', { level: 'warn', stderrLen: text.length })
    this.emit({ type: 'error', message: text })
    this.activityCb()
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      if (!this.firstOutputLogged) {
        this.firstOutputLogged = true
        this.diag('first_output', { lineLen: line.length })
      }
      let obj: any
      try { obj = JSON.parse(line) } catch {
        this.diag('json_parse_error', { level: 'warn', lineLen: line.length })
        continue
      }
      const turn = this.reducer.ingest(obj)
      if (!this.sessionEmitted && this.reducer.sessionId) {
        this.sessionEmitted = true
        this.diag('session', { sessionId: this.reducer.sessionId, model: this.reducer.model })
        this.emit({ type: 'session', sessionId: this.reducer.sessionId, model: this.reducer.model })
      }
      if (obj?.type === 'turn.completed' || obj?.type === 'result') this.diag('result', { wireType: obj.type })
      if (turn) { this.emit({ type: 'turn', turn }); this.activityCb() }
    }
  }

  private emit(frame: ChatFrame): void { this.frameCb(this.serialize(frame)) }
  private serialize(frame: ChatFrame): string { return JSON.stringify(frame) }
  private diag(event: string, fields: Record<string, unknown> = {}): void {
    logDiag({
      category: 'stream_turn',
      event,
      cli: this.opts?.diag?.cli,
      sessionId: this.opts?.diag?.sessionId ?? this.reducer.sessionId ?? undefined,
      launchToken: this.opts?.diag?.launchToken,
      ...fields,
    })
  }
}
