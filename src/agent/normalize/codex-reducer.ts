import { markTurnInterrupted, type Block, type ChatTurn, type Clock } from './chat-model'

/**
 * Reduces codex `exec --json` events into ChatTurn[]. Unlike claude, codex does NOT stream tokens:
 * each `codex exec` / `codex exec resume` invocation is ONE turn that emits thread.started →
 * turn.started → item.started/item.completed (agent_message / command_execution / reasoning / …) →
 * turn.completed. The PerTurnStreamDriver feeds successive per-turn processes into one reducer, so it
 * accumulates across turns; thread.started re-emits the same thread_id each resume (sets sessionId once).
 *
 * Verified live against codex-cli 0.139.0 (task smoke tests).
 */
export class CodexReducer {
  readonly turns: ChatTurn[] = []
  sessionId?: string
  model?: string
  private clock: Clock
  private current?: ChatTurn
  private toolByItemId = new Map<string, Block & { kind: 'tool_call' }>()

  constructor(clock: Clock) {
    this.clock = clock
  }

  ingest(line: any): ChatTurn | null {
    if (!line || typeof line !== 'object') return null
    switch (line.type) {
      case 'thread.started':
        if (!this.sessionId && typeof line.thread_id === 'string') this.sessionId = line.thread_id
        return null
      case 'turn.started':
        return this.beginTurn()
      case 'item.started':
      case 'item.completed':
        return this.onItem(line.item, line.type === 'item.completed')
      case 'turn.completed':
        return this.endTurn(line, false)
      case 'turn.failed':
        return this.endTurn(line, true)
      default:
        return null
    }
  }

  private beginTurn(): ChatTurn {
    const t: ChatTurn = { id: `c${this.turns.length}_${this.clock()}`, role: 'assistant', ts: this.clock(), blocks: [], streaming: true }
    this.current = t
    this.toolByItemId.clear()
    this.turns.push(t)
    return t
  }

  private ensureTurn(): ChatTurn {
    return this.current ?? this.beginTurn()
  }

  private onItem(item: any, completed: boolean): ChatTurn | null {
    if (!item || typeof item !== 'object') return null
    const turn = this.ensureTurn()
    if (item.type === 'agent_message') {
      if (completed && typeof item.text === 'string') turn.blocks.push({ kind: 'text', text: item.text })
      return turn
    }
    if (item.type === 'reasoning') {
      const text = typeof item.text === 'string' ? item.text : ''
      if (completed) turn.blocks.push({ kind: 'reasoning', text, opaque: !text })
      return turn
    }
    // Everything else (command_execution / mcp_tool_call / file_change / web_search / …) → tool_call.
    const id = typeof item.id === 'string' ? item.id : `item${turn.blocks.length}`
    let tc = this.toolByItemId.get(id)
    if (!tc) {
      tc = { kind: 'tool_call', id, name: item.type ?? 'tool', input: toolInput(item), status: 'running' }
      this.toolByItemId.set(id, tc)
      turn.blocks.push(tc)
    } else {
      tc.input = toolInput(item)
    }
    if (completed) {
      const ok = item.exit_code === undefined ? item.status !== 'failed' && item.status !== 'error' : item.exit_code === 0
      tc.status = ok ? 'done' : 'error'
      const output = item.aggregated_output ?? item.output ?? item.result
      if (output !== undefined) tc.result = { output, ok }
    }
    return turn
  }

  private endTurn(line: any, failed: boolean): ChatTurn | null {
    const t = this.current
    if (!t) return null
    t.streaming = false
    t.result = {
      usage: line.usage ? { input: line.usage.input_tokens, output: line.usage.output_tokens } : undefined,
      isError: failed || undefined,
      errorSubtype: failed && typeof line.error === 'string' ? line.error : undefined,
    }
    this.current = undefined
    return t
  }

  addUserTurn(text: string, id?: string): ChatTurn {
    const t: ChatTurn = { id: id ?? `u${this.turns.length}_${this.clock()}`, role: 'user', ts: this.clock(), blocks: [{ kind: 'text', text }] }
    this.turns.push(t)
    return t
  }

  interruptCurrent(): ChatTurn | null {
    const t = this.current
    if (!t) return null
    this.current = undefined
    this.toolByItemId.clear()
    return markTurnInterrupted(t)
  }

  snapshot(): ChatTurn[] {
    return this.turns
  }
}

function toolInput(item: any): unknown {
  if (typeof item.command === 'string') return { command: item.command }
  if (item.arguments !== undefined) return item.arguments
  if (item.changes !== undefined) return { changes: item.changes }
  const { id: _id, type: _type, status: _status, aggregated_output: _a, output: _o, ...rest } = item
  return Object.keys(rest).length ? rest : {}
}
