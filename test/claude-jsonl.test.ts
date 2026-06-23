import { describe, it, expect } from 'vitest'
import { parseClaudeJsonlTurns } from '../src/agent/normalize/claude-jsonl'

// Real claude on-disk jsonl shapes (redacted) — see task research finding 5.
const lines = (...objs: any[]) => objs.map((o) => JSON.stringify(o)).join('\n')

const humanUser = { type: 'user', uuid: 'u1', timestamp: '2026-06-22T10:00:00.000Z', message: { role: 'user', content: 'fix the bug' }, origin: { kind: 'human' }, promptSource: 'typed' }
const assistantText = { type: 'assistant', uuid: 'a1', timestamp: '2026-06-22T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } }
const assistantTool = { type: 'assistant', uuid: 'a2', timestamp: '2026-06-22T10:00:06.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'ls' } }] } }
const toolResult = { type: 'user', uuid: 'u2', timestamp: '2026-06-22T10:00:07.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'a.txt' }] }, toolUseResult: { success: true } }
// noise
const metaUser = { type: 'user', uuid: 'm1', isMeta: true, sourceToolUseID: 'toolu_x', timestamp: '2026-06-22T10:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'skill body here' }] } }
const sysReminderUser = { type: 'user', uuid: 'm2', timestamp: '2026-06-22T10:00:02.000Z', message: { role: 'user', content: '<system-reminder>do x</system-reminder>' } }
const snapshot = { type: 'file-history-snapshot', uuid: 's1' }
const sysLine = { type: 'system', subtype: 'turn_duration', uuid: 's2' }

describe('parseClaudeJsonlTurns', () => {
  it('renders a real human user line as a user turn with ts (epoch s) + uuid id', () => {
    const turns = parseClaudeJsonlTurns(lines(humanUser))
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: 'u1', role: 'user', blocks: [{ kind: 'text', text: 'fix the bug' }] })
    expect(turns[0].ts).toBe(Math.floor(Date.parse('2026-06-22T10:00:00.000Z') / 1000))
  })

  it('renders an assistant text line as an assistant turn', () => {
    const turns = parseClaudeJsonlTurns(lines(assistantText))
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: 'a1', role: 'assistant', blocks: [{ kind: 'text', text: 'On it.' }] })
  })

  it('folds a tool_use + its later tool_result (on a user line) into one tool_call block', () => {
    const turns = parseClaudeJsonlTurns(lines(assistantTool, toolResult))
    // tool_result does NOT create a user turn
    expect(turns.map((t) => t.role)).toEqual(['assistant'])
    const tc = turns[0].blocks[0] as any
    expect(tc).toMatchObject({ kind: 'tool_call', id: 'toolu_9', name: 'Bash', input: { command: 'ls' }, status: 'done' })
    expect(tc.result).toMatchObject({ output: 'a.txt', ok: true })
  })

  it('drops injected/meta user lines and control/noise lines', () => {
    const turns = parseClaudeJsonlTurns(lines(metaUser, sysReminderUser, snapshot, sysLine))
    expect(turns).toHaveLength(0)
  })

  it('handles a full sequence in order', () => {
    const turns = parseClaudeJsonlTurns(lines(humanUser, assistantText, assistantTool, toolResult))
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'assistant'])
  })

  it('skips malformed (non-JSON) lines without throwing', () => {
    const txt = JSON.stringify(humanUser) + '\nnot json{\n' + JSON.stringify(assistantText)
    const turns = parseClaudeJsonlTurns(txt)
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
  })
})
