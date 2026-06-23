import { describe, it, expect } from 'vitest'
import { ClaudeReducer } from '../src/agent/normalize/claude-reducer'

// Fixed clock so ts is deterministic.
const clock = () => 1000

// Real claude 2.1.186 stream-json wire shapes (captured in task smoke tests).
const sysInit = { type: 'system', subtype: 'init', session_id: 'sess-abc', model: 'claude-opus', cwd: '/x' }
const sysHook = { type: 'system', subtype: 'hook_started', hook_name: 'SessionStart' }
const rateLimit = { type: 'rate_limit_event', foo: 1 }
const msgStart = (id: string) => ({ type: 'stream_event', event: { type: 'message_start', message: { id } } })
const blockStart = (index: number, content_block: any) => ({ type: 'stream_event', event: { type: 'content_block_start', index, content_block } })
const textDelta = (index: number, text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } })
const inputDelta = (index: number, partial_json: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } } })
const blockStop = (index: number) => ({ type: 'stream_event', event: { type: 'content_block_stop', index } })
const toolResultUser = (tool_use_id: string, content: any, is_error?: boolean) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content, is_error }] } })
const resultOk = { type: 'result', subtype: 'success', is_error: false, duration_ms: 7677, total_cost_usd: 0.1, result: 'PONG', usage: { input_tokens: 10, output_tokens: 2 } }
const resultErr = { type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 500 }

describe('ClaudeReducer', () => {
  it('captures session id + model from system/init', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(sysInit)
    expect(r.sessionId).toBe('sess-abc')
    expect(r.model).toBe('claude-opus')
  })

  it('ignores noise lines (hooks, status, rate_limit, unknown) — no turns created', () => {
    const r = new ClaudeReducer(clock)
    expect(r.ingest(sysHook)).toBeNull()
    expect(r.ingest(rateLimit)).toBeNull()
    expect(r.ingest({ type: 'totally_unknown' })).toBeNull()
    expect(r.turns).toHaveLength(0)
  })

  it('builds one assistant turn from streamed text deltas, finalized by result', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'text', text: '' }))
    r.ingest(textDelta(0, 'PO'))
    const mid = r.ingest(textDelta(0, 'NG'))
    expect(mid).not.toBeNull()
    expect(r.turns).toHaveLength(1)
    expect(r.turns[0].role).toBe('assistant')
    expect(r.turns[0].blocks).toEqual([{ kind: 'text', text: 'PONG' }])
    expect(r.turns[0].streaming).toBe(true)
    expect(r.turns[0].ts).toBe(1000)

    r.ingest(resultOk)
    expect(r.turns[0].streaming).toBe(false)
    expect(r.turns[0].result).toMatchObject({ durationMs: 7677, costUsd: 0.1, isError: false })
    expect(r.turns[0].result?.usage).toMatchObject({ input: 10, output: 2 })
  })

  it('folds a tool_use block + its later tool_result into one collapsed tool_call block', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }))
    r.ingest(inputDelta(0, '{"command":'))
    r.ingest(inputDelta(0, '"ls"}'))
    r.ingest(blockStop(0))
    const t = r.turns[0]
    expect(t.blocks[0]).toMatchObject({ kind: 'tool_call', id: 'toolu_1', name: 'Bash', input: { command: 'ls' }, status: 'running' })

    // tool_result arrives later on a user line
    r.ingest(toolResultUser('toolu_1', 'file1\nfile2'))
    const tc = r.turns[0].blocks[0] as any
    expect(tc.status).toBe('done')
    expect(tc.result).toMatchObject({ output: 'file1\nfile2', ok: true })
  })

  it('marks a tool_call errored when tool_result.is_error is true', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }))
    r.ingest(blockStop(0))
    r.ingest(toolResultUser('toolu_2', 'boom', true))
    const tc = r.turns[0].blocks[0] as any
    expect(tc.status).toBe('error')
    expect(tc.result.ok).toBe(false)
  })

  it('captures reasoning (thinking) deltas as a reasoning block', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'thinking', thinking: '' }))
    r.ingest({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } })
    expect(r.turns[0].blocks[0]).toMatchObject({ kind: 'reasoning', text: 'hmm' })
  })

  it('records an errored result subtype on the turn', () => {
    const r = new ClaudeReducer(clock)
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'text', text: '' }))
    r.ingest(textDelta(0, 'partial'))
    r.ingest(resultErr)
    expect(r.turns[0].result).toMatchObject({ isError: true, errorSubtype: 'error_during_execution' })
  })

  it('addUserTurn appends an optimistic user bubble with a stable id', () => {
    const r = new ClaudeReducer(clock)
    const u = r.addUserTurn('hello there')
    expect(u.role).toBe('user')
    expect(u.blocks).toEqual([{ kind: 'text', text: 'hello there' }])
    expect(u.id).toBeTruthy()
    expect(r.turns).toContain(u)
  })

  it('keeps user and assistant turns in submission/stream order', () => {
    const r = new ClaudeReducer(clock)
    r.addUserTurn('q1')
    r.ingest(msgStart('m1'))
    r.ingest(blockStart(0, { type: 'text', text: '' }))
    r.ingest(textDelta(0, 'a1'))
    r.ingest(resultOk)
    r.addUserTurn('q2')
    expect(r.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect((r.turns[1].blocks[0] as any).text).toBe('a1')
  })
})
