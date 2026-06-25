import { markTurnInterrupted, type Block, type ChatTurn, type Clock } from './chat-model'

/**
 * Reduces the claude stream-json WIRE stream into ChatTurn[]. One instance per live session; the
 * StreamJsonDriver feeds it each parsed NDJSON line via `ingest`, calls `addUserTurn` when the viewer
 * submits a turn, and broadcasts the affected turn each time. Pure of I/O — `clock` is injected.
 */
export class ClaudeReducer {
  readonly turns: ChatTurn[] = []
  sessionId?: string
  model?: string
  private clock: Clock
  private current?: ChatTurn                      // the assistant turn being streamed
  private toolJson = new Map<number, string>()    // content_block index -> accumulating input_json
  private blockAt = new Map<number, Block>()      // content_block index -> the block object in `current`
  private toolById = new Map<string, Block & { kind: 'tool_call' }>()  // tool_use id -> its block (for tool_result)
  private seq = 0

  constructor(clock: Clock) {
    this.clock = clock
  }

  /** Ingest one parsed wire line. Returns the turn that changed (for incremental broadcast), or null. */
  ingest(line: any): ChatTurn | null {
    if (!line || typeof line !== 'object') return null
    switch (line.type) {
      case 'system':
        if (line.subtype === 'init') {
          if (!this.sessionId && typeof line.session_id === 'string') this.sessionId = line.session_id
          if (!this.model && typeof line.model === 'string') this.model = line.model
        }
        return null   // init re-emits per turn; hooks/status are noise
      case 'stream_event':
        return this.onStreamEvent(line.event)
      case 'assistant':
        return this.onAssistantLine(line)
      case 'user':
        return this.onUserLine(line)
      case 'result':
        return this.onResult(line)
      default:
        return null   // rate_limit_event, anything unknown
    }
  }

  /**
   * A COMPLETE assistant message. claude streams via stream_event deltas and this line is redundant
   * (current is set) → ignore. coco does NOT stream partials — it emits only this whole message with
   * content as a string or block array → build the turn from it.
   */
  private onAssistantLine(line: any): ChatTurn | null {
    if (this.current) return null   // claude: deltas already built the turn
    const content = line.message?.content
    const blocks = blocksFromMessageContent(content, this.toolById)
    if (!blocks.length) return null
    const t: ChatTurn = { id: this.turnId(line.uuid), role: 'assistant', ts: this.clock(), blocks, streaming: true }
    this.current = t
    this.turns.push(t)
    return t
  }

  private onStreamEvent(ev: any): ChatTurn | null {
    if (!ev || typeof ev !== 'object') return null
    switch (ev.type) {
      case 'message_start': {
        const t = this.current ?? { id: this.turnId(ev.message?.id), role: 'assistant' as const, ts: this.clock(), blocks: [], streaming: true }
        if (!this.current) {
          this.current = t
          this.turns.push(t)
        }
        this.blockAt.clear()
        this.toolJson.clear()
        return t
      }
      case 'content_block_start': {
        if (!this.current) return null
        const cb = ev.content_block || {}
        const idx = ev.index ?? this.current.blocks.length
        let block: Block
        if (cb.type === 'tool_use') {
          const tc = { kind: 'tool_call' as const, id: cb.id, name: cb.name, input: cb.input ?? {}, status: 'running' as const }
          this.toolById.set(cb.id, tc)
          this.toolJson.set(idx, '')
          block = tc
        } else if (cb.type === 'thinking') {
          block = { kind: 'reasoning', text: cb.thinking ?? '', opaque: false }
        } else {
          block = { kind: 'text', text: cb.text ?? '' }
        }
        this.blockAt.set(idx, block)
        this.current.blocks.push(block)
        return this.current
      }
      case 'content_block_delta': {
        if (!this.current) return null
        const idx = ev.index ?? 0
        const block = this.blockAt.get(idx)
        const d = ev.delta || {}
        if (!block) return null
        if (d.type === 'text_delta' && block.kind === 'text') block.text += d.text ?? ''
        else if (d.type === 'thinking_delta' && block.kind === 'reasoning') block.text += d.thinking ?? ''
        else if (d.type === 'input_json_delta') this.toolJson.set(idx, (this.toolJson.get(idx) ?? '') + (d.partial_json ?? ''))
        else return null
        return this.current
      }
      case 'content_block_stop': {
        if (!this.current) return null
        const idx = ev.index ?? 0
        const block = this.blockAt.get(idx)
        if (block?.kind === 'tool_call') {
          const raw = this.toolJson.get(idx)
          if (raw) { try { block.input = JSON.parse(raw) } catch { /* keep partial/empty input */ } }
        }
        return this.current
      }
      default:
        return null   // message_delta / message_stop — nothing to render
    }
  }

  private onUserLine(line: any): ChatTurn | null {
    // A `type:"user"` line carries tool_result blocks, NOT a human turn (human turns are added
    // optimistically via addUserTurn). Fold each tool_result into its tool_call block.
    const content = line.message?.content
    if (!Array.isArray(content)) return null
    let changed: ChatTurn | null = null
    for (const b of content) {
      if (b?.type !== 'tool_result') continue
      const tc = this.toolById.get(b.tool_use_id)
      if (!tc) continue
      const ok = !b.is_error
      tc.status = ok ? 'done' : 'error'
      tc.result = { output: b.content, ok }
      changed = this.current ?? changed
    }
    return changed
  }

  private onResult(line: any): ChatTurn | null {
    const t = this.current
    if (!t) return null
    t.streaming = false
    t.result = {
      durationMs: typeof line.duration_ms === 'number' ? line.duration_ms : undefined,
      costUsd: typeof line.total_cost_usd === 'number' ? line.total_cost_usd : undefined,
      usage: line.usage ? { input: line.usage.input_tokens, output: line.usage.output_tokens, cacheRead: line.usage.cache_read_input_tokens } : undefined,
      isError: !!line.is_error,
      errorSubtype: line.is_error && typeof line.subtype === 'string' ? line.subtype : undefined,
    }
    this.current = undefined
    return t
  }

  /** Add an optimistic user turn (the viewer's submitted message). Returns the new turn. */
  addUserTurn(text: string, id?: string): ChatTurn {
    const t: ChatTurn = { id: id ?? this.turnId(), role: 'user', ts: this.clock(), blocks: [{ kind: 'text', text }] }
    this.turns.push(t)
    return t
  }

  interruptCurrent(): ChatTurn | null {
    const t = this.current
    if (!t) return null
    this.current = undefined
    this.toolJson.clear()
    this.blockAt.clear()
    return markTurnInterrupted(t)
  }

  snapshot(): ChatTurn[] {
    return this.turns
  }

  private turnId(hint?: string): string {
    return hint ? `${hint}` : `t${++this.seq}`
  }
}

/** Blocks from a COMPLETE assistant message.content (string | block array) — coco's whole-message
 *  form. Registers any tool_use in toolById so a later tool_result still folds in. */
function blocksFromMessageContent(content: any, toolById: Map<string, Block & { kind: 'tool_call' }>): Block[] {
  if (typeof content === 'string') return content ? [{ kind: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  const blocks: Block[] = []
  for (const b of content) {
    if (b?.type === 'text') { if (b.text) blocks.push({ kind: 'text', text: b.text }) }
    else if (b?.type === 'thinking') { if (b.thinking) blocks.push({ kind: 'reasoning', text: b.thinking, opaque: false }) }
    else if (b?.type === 'tool_use') {
      const tc: Block & { kind: 'tool_call' } = { kind: 'tool_call', id: b.id, name: b.name, input: b.input ?? {}, status: 'running' }
      toolById.set(b.id, tc)
      blocks.push(tc)
    }
  }
  return blocks
}
