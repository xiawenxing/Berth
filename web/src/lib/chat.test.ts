import { describe, it, expect } from 'vitest'
import { applyChatFrame, chatBusy, chatThinking, clearsAwaiting, makeUserTurn, stopInFlightTurns, turnHasVisibleContent, type ChatTurn } from './chat'

const turn = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<ChatTurn> = {}): ChatTurn =>
  ({ id, role, ts: 1, blocks: [{ kind: 'text', text }], ...extra })

describe('applyChatFrame', () => {
  it('snapshot replaces the whole list', () => {
    const prev = [turn('a', 'user', 'old')]
    const next = applyChatFrame(prev, { type: 'snapshot', turns: [turn('x', 'user', 'hi'), turn('y', 'assistant', 'yo')] })
    expect(next.map((t) => t.id)).toEqual(['x', 'y'])
  })

  it('does not let an empty live snapshot erase REST-loaded history', () => {
    const prev = [turn('replay_0', 'user', '历史问题'), turn('replay_1', 'assistant', '历史回复')]
    expect(applyChatFrame(prev, { type: 'snapshot', turns: [] })).toBe(prev)
  })

  it('keeps an empty snapshot empty when there is no REST-loaded history', () => {
    expect(applyChatFrame([], { type: 'snapshot', turns: [] })).toEqual([])
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

  it('preserves optimistic user images when the server echoes an attachment label', () => {
    const prev = [makeUserTurn('u1', '看这里', 1, [{ src: 'data:image/png;base64,AAAA', alt: 'shot.png' }])]
    const next = applyChatFrame(prev, { type: 'turn', turn: turn('u1', 'user', '看这里\n\n已附加 1 张图片') })
    expect(next).toHaveLength(1)
    expect(next[0].blocks).toMatchObject([
      { kind: 'image', src: 'data:image/png;base64,AAAA', alt: 'shot.png' },
      { kind: 'text', text: '看这里' },
    ])
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

describe('chatThinking', () => {
  it('keeps thinking visible while awaiting the first assistant frame', () => {
    expect(chatThinking([turn('a', 'user', 'q')], true)).toBe(true)
  })

  it('keeps thinking visible for an empty streaming assistant shell', () => {
    const empty: ChatTurn = { id: 'b', role: 'assistant', ts: 1, blocks: [], streaming: true }
    expect(chatThinking([turn('a', 'user', 'q'), empty], false)).toBe(true)
  })

  it('clears thinking once the streaming assistant has renderable content', () => {
    expect(chatThinking([turn('b', 'assistant', 'hello', { streaming: true })], false)).toBe(false)
  })
})

describe('stopInFlightTurns', () => {
  it('removes an empty streaming assistant shell so thinking can clear immediately', () => {
    const empty: ChatTurn = { id: 'b', role: 'assistant', ts: 1, blocks: [], streaming: true }
    expect(stopInFlightTurns([turn('a', 'user', 'q'), empty])).toEqual([turn('a', 'user', 'q')])
  })

  it('settles a visible streaming assistant turn and marks running tools interrupted', () => {
    const streaming: ChatTurn = {
      id: 'b',
      role: 'assistant',
      ts: 1,
      streaming: true,
      blocks: [{ kind: 'tool_call', id: 'x', name: 'Bash', input: {}, status: 'running' }],
    }
    const [stopped] = stopInFlightTurns([streaming])
    expect(stopped).toMatchObject({ streaming: false, result: { isError: true, errorSubtype: 'interrupted' } })
    expect(stopped.blocks[0]).toMatchObject({ kind: 'tool_call', status: 'error', result: { ok: false } })
  })
})

describe('turnHasVisibleContent', () => {
  it('treats empty text-only turns as invisible', () => {
    expect(turnHasVisibleContent(turn('b', 'assistant', '   '))).toBe(false)
  })

  it('treats tool calls as visible progress', () => {
    const t: ChatTurn = { id: 'b', role: 'assistant', ts: 1, blocks: [{ kind: 'tool_call', id: 'x', name: 'Read', input: {}, status: 'running' }] }
    expect(turnHasVisibleContent(t)).toBe(true)
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
