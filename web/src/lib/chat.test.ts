import { describe, it, expect } from 'vitest'
import { applyChatFrame, chatBusy, clearsAwaiting, type ChatTurn } from './chat'

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

  it('session frames leave the turn list unchanged', () => {
    const prev = [turn('a', 'user', 'q')]
    expect(applyChatFrame(prev, { type: 'session', sessionId: 's' })).toBe(prev)
  })

  it('error frames append a failed assistant turn', () => {
    const prev = [turn('a', 'user', 'q')]
    const next = applyChatFrame(prev, { type: 'error', message: 'boom' })
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ role: 'assistant', result: { isError: true } })
    expect((next[1].blocks[0] as any).text).toBe('boom')
  })
})

describe('chatBusy', () => {
  it('is busy when awaiting the agent, even before any streaming turn exists', () => {
    expect(chatBusy([turn('a', 'user', 'q')], true)).toBe(true)
  })
  it('is busy while an assistant turn is streaming, even if no longer awaiting', () => {
    expect(chatBusy([turn('a', 'user', 'q'), turn('b', 'assistant', '…', { streaming: true })], false)).toBe(true)
  })
  it('is idle when not awaiting and nothing is streaming', () => {
    expect(chatBusy([turn('a', 'user', 'q'), turn('b', 'assistant', 'done')], false)).toBe(false)
  })
})

describe('clearsAwaiting', () => {
  it('an assistant turn frame clears the awaiting gap (the agent has begun responding)', () => {
    expect(clearsAwaiting({ type: 'turn', turn: turn('b', 'assistant', '…', { streaming: true }) })).toBe(true)
  })
  it('an error frame clears awaiting (the turn failed to start)', () => {
    expect(clearsAwaiting({ type: 'error', message: 'boom' })).toBe(true)
  })
  it('the echoed user turn does NOT clear awaiting (still waiting on the agent)', () => {
    expect(clearsAwaiting({ type: 'turn', turn: turn('a', 'user', 'q') })).toBe(false)
  })
  it('a session frame does not clear awaiting', () => {
    expect(clearsAwaiting({ type: 'session', sessionId: 's' })).toBe(false)
  })
})
