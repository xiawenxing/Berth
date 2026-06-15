import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { latestCodexTurnState } from '../src/adapters/codex-turn'

function rollout(lines: any[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-codex-turn-'))
  const p = join(dir, 'rollout.jsonl')
  writeFileSync(p, lines.map(x => JSON.stringify(x)).join('\n') + '\n')
  return p
}

const event = (type: string, turn_id = 'turn-1') => ({
  timestamp: '2026-06-15T01:00:00.000Z',
  type: 'event_msg',
  payload: { type, turn_id },
})

describe('latestCodexTurnState', () => {
  it('reports running after the latest task_started event', () => {
    const p = rollout([
      event('task_started'),
      { timestamp: '2026-06-15T01:00:01.000Z', type: 'response_item', payload: { type: 'function_call' } },
    ])
    expect(latestCodexTurnState(p)).toBe('running')
  })

  it('reports complete after task_complete or turn_aborted closes the latest turn', () => {
    expect(latestCodexTurnState(rollout([event('task_started'), event('task_complete')]))).toBe('complete')
    expect(latestCodexTurnState(rollout([event('task_started'), event('turn_aborted')]))).toBe('complete')
  })

  it('uses the latest lifecycle event across multiple turns', () => {
    const p = rollout([
      event('task_started', 'turn-1'),
      event('task_complete', 'turn-1'),
      event('task_started', 'turn-2'),
    ])
    expect(latestCodexTurnState(p)).toBe('running')
  })

  it('returns unknown when no lifecycle event is readable', () => {
    const p = rollout([{ timestamp: '2026-06-15T01:00:00.000Z', type: 'response_item', payload: {} }])
    expect(latestCodexTurnState(p)).toBe('unknown')
    expect(latestCodexTurnState('/missing/rollout.jsonl')).toBe('unknown')
  })
})
