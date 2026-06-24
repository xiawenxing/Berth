import { describe, it, expect } from 'vitest'
import { CodexReducer } from '../src/agent/normalize/codex-reducer'

const clock = () => 1000
// Real codex-cli 0.139.0 `exec --json` wire shapes (captured in task smoke tests).
const threadStarted = { type: 'thread.started', thread_id: '019ef4a9-fa8b-7810-ae3f-ff7da5d1546e' }
const turnStarted = { type: 'turn.started' }
const agentMsg = { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'PONG' } }
const cmdStarted = { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'ls', status: 'in_progress' } }
const cmdDone = { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt\n', exit_code: 0, status: 'completed' } }
const cmdFail = { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'bad', aggregated_output: 'err', exit_code: 1, status: 'completed' } }
const turnCompleted = { type: 'turn.completed', usage: { input_tokens: 17471, output_tokens: 19 } }
const turnFailed = { type: 'turn.failed', error: 'boom' }

describe('CodexReducer', () => {
  it('captures session id from thread.started (once, even when re-emitted on resume)', () => {
    const r = new CodexReducer(clock)
    r.ingest(threadStarted)
    expect(r.sessionId).toBe('019ef4a9-fa8b-7810-ae3f-ff7da5d1546e')
    r.ingest({ type: 'thread.started', thread_id: 'different' })
    expect(r.sessionId).toBe('019ef4a9-fa8b-7810-ae3f-ff7da5d1546e')
  })

  it('builds an assistant turn from turn.started + agent_message + turn.completed', () => {
    const r = new CodexReducer(clock)
    r.ingest(threadStarted)
    r.ingest(turnStarted)
    r.ingest(agentMsg)
    expect(r.turns).toHaveLength(1)
    expect(r.turns[0]).toMatchObject({ role: 'assistant', blocks: [{ kind: 'text', text: 'PONG' }], streaming: true })
    r.ingest(turnCompleted)
    expect(r.turns[0].streaming).toBe(false)
    expect(r.turns[0].result?.usage).toMatchObject({ input: 17471, output: 19 })
  })

  it('folds a command_execution started→completed into one tool_call block with output', () => {
    const r = new CodexReducer(clock)
    r.ingest(turnStarted)
    r.ingest(cmdStarted)
    expect(r.turns[0].blocks[0]).toMatchObject({ kind: 'tool_call', name: 'command_execution', status: 'running', input: { command: 'ls' } })
    r.ingest(cmdDone)
    const tc = r.turns[0].blocks[0] as any
    expect(tc.status).toBe('done')
    expect(tc.result).toMatchObject({ output: 'a.txt\n', ok: true })
  })

  it('marks a non-zero exit_code tool_call as error', () => {
    const r = new CodexReducer(clock)
    r.ingest(turnStarted)
    r.ingest(cmdFail)
    const tc = r.turns[0].blocks[0] as any
    expect(tc.status).toBe('error')
    expect(tc.result.ok).toBe(false)
  })

  it('records turn.failed as an errored result', () => {
    const r = new CodexReducer(clock)
    r.ingest(turnStarted)
    r.ingest(agentMsg)
    r.ingest(turnFailed)
    expect(r.turns[0].result).toMatchObject({ isError: true, errorSubtype: 'boom' })
  })

  it('accumulates across turns (each per-turn process pushes a new assistant turn)', () => {
    const r = new CodexReducer(clock)
    r.addUserTurn('q1')
    r.ingest(threadStarted); r.ingest(turnStarted); r.ingest(agentMsg); r.ingest(turnCompleted)
    r.addUserTurn('q2')
    r.ingest(threadStarted); r.ingest(turnStarted); r.ingest({ type: 'item.completed', item: { type: 'agent_message', text: 'two' } }); r.ingest(turnCompleted)
    expect(r.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect((r.turns[3].blocks[0] as any).text).toBe('two')
  })
})
