import { describe, it, expect } from 'vitest'
import { applyChatFrame, type ChatTurn } from './chat'

const turn = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<ChatTurn> = {}): ChatTurn =>
  ({ id, role, ts: 1, blocks: [{ kind: 'text', text }], ...extra })

describe('applyChatFrame', () => {
  it('snapshot replaces the whole list', () => {
    const prev = [turn('a', 'user', 'old')]
    const next = applyChatFrame(prev, { type: 'snapshot', turns: [turn('x', 'user', 'hi'), turn('y', 'assistant', 'yo')] })
    expect(next.map((t) => t.id)).toEqual(['x', 'y'])
  })

  it('a turn frame appends a new turn', () => {
    const next = applyChatFrame([turn('a', 'user', 'q')], { type: 'turn', turn: turn('b', 'assistant', 'a') })
    expect(next.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('a turn frame upserts (replaces) an existing turn by id, preserving position', () => {
    const prev = [turn('a', 'user', 'q'), turn('b', 'assistant', 'partial', { streaming: true })]
    const next = applyChatFrame(prev, { type: 'turn', turn: turn('b', 'assistant', 'complete', { streaming: false }) })
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ id: 'b', streaming: false })
    expect((next[1].blocks[0] as any).text).toBe('complete')
  })

  it('session and error frames leave the turn list unchanged', () => {
    const prev = [turn('a', 'user', 'q')]
    expect(applyChatFrame(prev, { type: 'session', sessionId: 's' })).toBe(prev)
    expect(applyChatFrame(prev, { type: 'error', message: 'boom' })).toBe(prev)
  })
})
