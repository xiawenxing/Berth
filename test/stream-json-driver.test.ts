import { describe, it, expect, vi } from 'vitest'

const saveAttachment = vi.hoisted(() => vi.fn((_dataUrl: string, _nameHint: string) => ({
  rel: 'assets/x.png',
  abs: '/tmp/berth-docs/assets/x.png',
})))
vi.mock('../src/data/docstore', () => ({
  currentDocStore: () => ({ saveAttachment }),
}))

import { StreamJsonDriver, type ChildLike } from '../src/server/stream-json-driver'
import type { ChatFrame } from '../src/agent/normalize/chat-model'

// Fake child: drive stdout, capture stdin writes + kill, trigger exit.
function fakeChild(pid = 4242) {
  let dataCb: (d: string) => void = () => {}
  let errCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  const stdinWrites: string[] = []
  const child: ChildLike = {
    pid,
    stdout: { on: (_ev, cb) => { dataCb = cb } },
    stderr: { on: (_ev, cb) => { errCb = cb } },
    stdin: { write: (s) => { stdinWrites.push(s) } },
    on: (_ev, cb) => { exitCb = cb },
    kill: vi.fn(),
  }
  return { child, emit: (s: string) => dataCb(s), emitErr: (s: string) => errCb(s), exit: () => exitCb(), stdinWrites, killSpy: child.kill as any }
}

const clock = () => 1000
const parseFrames = (sent: string[]): ChatFrame[] => sent.map((s) => JSON.parse(s))

describe('StreamJsonDriver', () => {
  it('exposes pid and forwards kill to the child', () => {
    const f = fakeChild(99)
    const d = new StreamJsonDriver(f.child, { clock })
    expect(d.pid).toBe(99)
    d.kill('SIGTERM')
    expect(f.killSpy).toHaveBeenCalledWith('SIGTERM')
  })

  it('emits a session frame once when system/init arrives', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    f.emit(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sx', model: 'opus' }) + '\n')
    const frames = parseFrames(sent)
    expect(frames.find((x) => x.type === 'session')).toMatchObject({ type: 'session', sessionId: 'sx', model: 'opus' })
    // re-emitted init (claude does this per turn) must NOT produce a second session frame
    f.emit(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sx' }) + '\n')
    expect(parseFrames(sent).filter((x) => x.type === 'session')).toHaveLength(1)
  })

  it('reduces streamed text deltas into turn frames + fires activity', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    let activity = 0
    d.onFrame((s) => sent.push(s))
    d.onActivity(() => { activity++ })
    f.emit(JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }) + '\n')
    f.emit(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }) + '\n')
    f.emit(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } } }) + '\n')
    const turnFrames = parseFrames(sent).filter((x) => x.type === 'turn') as Extract<ChatFrame, { type: 'turn' }>[]
    expect(turnFrames.length).toBeGreaterThan(0)
    const last = turnFrames[turnFrames.length - 1]
    expect(last.turn.role).toBe('assistant')
    expect(last.turn.blocks).toEqual([{ kind: 'text', text: 'hi' }])
    expect(activity).toBeGreaterThan(0)
  })

  it('handles NDJSON lines split across stdout chunks', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sy' })
    f.emit(line.slice(0, 10))           // partial — no newline yet
    expect(sent).toHaveLength(0)
    f.emit(line.slice(10) + '\n')       // completes the line
    expect(parseFrames(sent).find((x) => x.type === 'session')).toMatchObject({ sessionId: 'sy' })
  })

  it('send turn: writes an NDJSON user message to stdin AND emits an optimistic user turn frame', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'do the thing', clientTurnId: 'client-1' })
    // stdin line is valid NDJSON with the SDKUserMessage shape
    expect(f.stdinWrites).toHaveLength(1)
    const obj = JSON.parse(f.stdinWrites[0].trim())
    expect(obj).toMatchObject({ type: 'user', message: { role: 'user', content: 'do the thing' }, parent_tool_use_id: null })
    expect(f.stdinWrites[0].endsWith('\n')).toBe(true)
    // optimistic user bubble emitted
    const turnFrames = parseFrames(sent).filter((x) => x.type === 'turn') as Extract<ChatFrame, { type: 'turn' }>[]
    expect(turnFrames[0].turn).toMatchObject({ id: 'client-1', role: 'user', blocks: [{ kind: 'text', text: 'do the thing' }] })
  })

  it('send turn with images: persists images, shows a short attachment label, and sends paths to the agent', () => {
    saveAttachment.mockClear()
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'look at this', clientTurnId: 'client-img', images: [{ name: 'shot', dataUrl: 'data:image/png;base64,AAAA' }] })
    expect(saveAttachment).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'shot')
    const obj = JSON.parse(f.stdinWrites[0].trim())
    expect(obj.message.content).toContain('look at this')
    expect(obj.message.content).toContain('Attached images:')
    expect(obj.message.content).toContain('/tmp/berth-docs/assets/x.png')
    const turnFrames = parseFrames(sent).filter((x) => x.type === 'turn') as Extract<ChatFrame, { type: 'turn' }>[]
    expect(turnFrames[0].turn.blocks).toEqual([{ kind: 'text', text: 'look at this\n\n已附加 1 张图片' }])
  })

  it('dedupes repeated client turn ids before writing to stdin', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    d.send({ t: 'turn', text: 'once', clientTurnId: 'same-id' })
    d.send({ t: 'turn', text: 'twice', clientTurnId: 'same-id' })
    expect(f.stdinWrites).toHaveLength(1)
    expect(JSON.parse(f.stdinWrites[0].trim()).message.content).toBe('once')
  })

  it('emits stderr as an error frame instead of swallowing it', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    f.emitErr('auth failed\n')
    expect(parseFrames(sent)[0]).toEqual({ type: 'error', message: 'auth failed' })
  })

  it('send interrupt: writes a control_request with subtype interrupt to stdin', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    d.send({ t: 'interrupt' })
    const obj = JSON.parse(f.stdinWrites[0].trim())
    expect(obj.type).toBe('control_request')
    expect(obj.request).toEqual({ subtype: 'interrupt' })
    expect(typeof obj.request_id).toBe('string')
  })

  it('send interrupt settles the current streaming turn immediately', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'go', clientTurnId: 'c1' })
    f.emit(JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }) + '\n')
    expect(d.turnActive()).toBe(true)

    d.send({ t: 'interrupt' })

    expect(d.turnActive()).toBe(false)
    const last = parseFrames(sent).filter((x) => x.type === 'turn').pop() as Extract<ChatFrame, { type: 'turn' }>
    expect(last.turn).toMatchObject({ role: 'assistant', streaming: false, result: { isError: true, errorSubtype: 'interrupted' } })
  })

  it('initialPrompt is sent as the first user turn on construction', () => {
    const f = fakeChild()
    new StreamJsonDriver(f.child, { clock, initialPrompt: 'kick off' })
    const obj = JSON.parse(f.stdinWrites[0].trim())
    expect(obj.message.content).toBe('kick off')
  })

  it('snapshot replays the full reduced state as one snapshot frame', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    d.send({ t: 'turn', text: 'q1' })
    const snap = d.snapshot()
    expect(snap).toHaveLength(1)
    const frame = JSON.parse(snap[0]) as ChatFrame
    expect(frame.type).toBe('snapshot')
    if (frame.type === 'snapshot') expect(frame.turns[0]).toMatchObject({ role: 'user', blocks: [{ kind: 'text', text: 'q1' }] })
  })

  it('forwards child exit', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    let exited = false
    d.onExit(() => { exited = true })
    f.exit()
    expect(exited).toBe(true)
  })

  it('turnActive: false at rest, true from a submitted turn through the silent thinking gap, false at the result', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    expect(d.turnActive()).toBe(false)
    d.send({ t: 'turn', text: 'go', clientTurnId: 'c1' })
    expect(d.turnActive()).toBe(true)        // submitted but no agent output yet (the thinking gap)
    f.emit(JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }) + '\n')
    expect(d.turnActive()).toBe(true)        // streaming
    f.emit(JSON.stringify({ type: 'result', duration_ms: 5 }) + '\n')
    expect(d.turnActive()).toBe(false)       // turn complete
  })

  it('turnActive: true while the initialPrompt turn is in flight, false once it results', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock, initialPrompt: 'kick' })
    expect(d.turnActive()).toBe(true)
    f.emit(JSON.stringify({ type: 'result' }) + '\n')
    expect(d.turnActive()).toBe(false)
  })

  it('turnActive: an empty/deduped submit does not light a phantom turn', () => {
    const f = fakeChild()
    const d = new StreamJsonDriver(f.child, { clock })
    d.send({ t: 'turn', text: '   ', clientTurnId: 'blank' })   // no agent text → nothing sent
    expect(d.turnActive()).toBe(false)
  })
})
