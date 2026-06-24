import { describe, it, expect, vi } from 'vitest'

const saveAttachment = vi.hoisted(() => vi.fn((_dataUrl: string, _nameHint: string) => ({
  rel: 'assets/x.png',
  abs: '/tmp/berth-docs/assets/x.png',
})))
vi.mock('../src/data/docstore', () => ({
  currentDocStore: () => ({ saveAttachment }),
}))

import { PerTurnStreamDriver } from '../src/server/per-turn-stream-driver'
import { CodexReducer } from '../src/agent/normalize/codex-reducer'
import type { ChildLike } from '../src/server/stream-json-driver'
import type { ChatFrame } from '../src/agent/normalize/chat-model'

function fakeChild(pid = 100) {
  let dataCb: (d: string) => void = () => {}
  let errCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  const child: ChildLike = {
    pid,
    stdout: { on: (_e, cb) => { dataCb = cb } },
    stderr: { on: (_e, cb) => { errCb = cb } },
    stdin: { write: () => {} },
    on: (_e, cb) => { exitCb = cb },
    kill: vi.fn(),
  }
  return { child, emit: (s: string) => dataCb(s), emitErr: (s: string) => errCb(s), exit: () => exitCb(), killSpy: child.kill as any }
}

const clock = () => 1000
const frames = (sent: string[]) => sent.map((s) => JSON.parse(s) as ChatFrame)
const codexTurn = (text: string) => [
  JSON.stringify({ type: 'thread.started', thread_id: 'tid-1' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
].join('\n') + '\n'

describe('PerTurnStreamDriver', () => {
  it('initialPrompt spawns the first turn with resumeId=null (fresh) + optimistic user bubble', () => {
    const spawns: Array<{ prompt: string; resumeId: string | null }> = []
    const spawnTurn = (prompt: string, resumeId: string | null) => { spawns.push({ prompt, resumeId }); return fakeChild().child }
    const d = new PerTurnStreamDriver(new CodexReducer(clock), spawnTurn, { initialPrompt: 'hello' })
    expect(spawns).toEqual([{ prompt: 'hello', resumeId: null }])
    const snap = JSON.parse(d.snapshot()[0]) as ChatFrame
    expect(snap.type === 'snapshot' && snap.turns[0]).toMatchObject({ role: 'user', blocks: [{ kind: 'text', text: 'hello' }] })
  })

  it('pumps a turn process stdout into turn frames + a session frame, and pid tracks the active child', () => {
    const f = fakeChild(777)
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => f.child, { initialPrompt: 'q' })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    expect(d.pid).toBe(777)         // active during the turn
    f.emit(codexTurn('PONG'))
    const fr = frames(sent)
    expect(fr.find((x) => x.type === 'session')).toMatchObject({ sessionId: 'tid-1' })
    const lastTurn = fr.filter((x) => x.type === 'turn').pop() as Extract<ChatFrame, { type: 'turn' }>
    expect(lastTurn.turn).toMatchObject({ role: 'assistant', streaming: false, blocks: [{ kind: 'text', text: 'PONG' }] })
  })

  it('QUEUES a turn submitted while the previous turn process is still alive (the result/exit race)', () => {
    // codex emits its result frame a beat BEFORE the process exits; a turn sent in that window must
    // not be dropped — it queues and fires once the active child exits.
    const children: ReturnType<typeof fakeChild>[] = []
    const spawnTurn = () => { const f = fakeChild(); children.push(f); return f.child }
    const d = new PerTurnStreamDriver(new CodexReducer(clock), spawnTurn, { initialPrompt: 'q1' })
    expect(children).toHaveLength(1)
    // turn1 emits its result, but child1 has NOT exited yet — submit turn2 in that window
    children[0].emit(codexTurn('a1'))
    d.send({ t: 'turn', text: 'q2' })
    expect(children).toHaveLength(1)        // not spawned yet (child1 still active)
    children[0].exit()                       // child1 exits → queued turn fires
    expect(children).toHaveLength(2)         // q2 now spawned
  })

  it('a child exit ends the TURN, not the session: driver.onExit is NOT fired and pid clears', () => {
    const f = fakeChild()
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => f.child, { initialPrompt: 'q' })
    let sessionEnded = false
    d.onExit(() => { sessionEnded = true })
    f.emit(codexTurn('PONG'))
    f.exit()
    expect(sessionEnded).toBe(false)
    expect(d.pid).toBeUndefined()
  })

  it('a 2nd turn spawns with resumeId = the captured session id (resume, not fresh)', () => {
    const spawns: Array<{ prompt: string; resumeId: string | null }> = []
    let cur = fakeChild()
    const spawnTurn = (prompt: string, resumeId: string | null) => { spawns.push({ prompt, resumeId }); cur = fakeChild(); return cur.child }
    const d = new PerTurnStreamDriver(new CodexReducer(clock), spawnTurn, { initialPrompt: 'q1' })
    // finish turn 1 (captures thread_id tid-1) — re-pump on the active child
    ;(cur as any) // first child is the one from initialPrompt; emit via the driver's pump by re-creating
    // emulate: the driver pumped `cur`. Just drive the latest child:
    cur.emit(codexTurn('a1')); cur.exit()
    d.send({ t: 'turn', text: 'q2' })
    expect(spawns).toEqual([
      { prompt: 'q1', resumeId: null },
      { prompt: 'q2', resumeId: 'tid-1' },
    ])
  })

  it('resumeId seed makes the FIRST turn resume the existing session (codex/coco resume open)', () => {
    const spawns: Array<{ prompt: string; resumeId: string | null }> = []
    const spawnTurn = (prompt: string, resumeId: string | null) => { spawns.push({ prompt, resumeId }); return fakeChild().child }
    const d = new PerTurnStreamDriver(new CodexReducer(clock), spawnTurn, { resumeId: 'existing-id' })
    d.send({ t: 'turn', text: 'continue' })
    expect(spawns).toEqual([{ prompt: 'continue', resumeId: 'existing-id' }])
  })

  it('preserves the client turn id for the optimistic user bubble', () => {
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => fakeChild().child)
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'continue', clientTurnId: 'client-2' })
    const userFrame = frames(sent).find((x) => x.type === 'turn' && x.turn.role === 'user') as Extract<ChatFrame, { type: 'turn' }>
    expect(userFrame.turn).toMatchObject({ id: 'client-2', role: 'user', blocks: [{ kind: 'text', text: 'continue' }] })
  })

  it('send turn with images: persists images, displays an attachment label, and spawns with image paths', () => {
    saveAttachment.mockClear()
    const spawns: Array<{ prompt: string; resumeId: string | null }> = []
    const d = new PerTurnStreamDriver(new CodexReducer(clock), (prompt, resumeId) => {
      spawns.push({ prompt, resumeId })
      return fakeChild().child
    })
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'inspect', clientTurnId: 'client-img', images: [{ name: 'shot', dataUrl: 'data:image/png;base64,AAAA' }] })
    expect(saveAttachment).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'shot')
    expect(spawns[0].prompt).toContain('inspect')
    expect(spawns[0].prompt).toContain('Attached images:')
    expect(spawns[0].prompt).toContain('/tmp/berth-docs/assets/x.png')
    const userFrame = frames(sent).find((x) => x.type === 'turn' && x.turn.role === 'user') as Extract<ChatFrame, { type: 'turn' }>
    expect(userFrame.turn.blocks).toEqual([{ kind: 'text', text: 'inspect\n\n已附加 1 张图片' }])
  })

  it('dedupes repeated client turn ids before spawning a turn', () => {
    const spawns: string[] = []
    const d = new PerTurnStreamDriver(new CodexReducer(clock), (prompt) => { spawns.push(prompt); return fakeChild().child })
    d.send({ t: 'turn', text: 'once', clientTurnId: 'same-id' })
    d.send({ t: 'turn', text: 'twice', clientTurnId: 'same-id' })
    expect(spawns).toEqual(['once'])
  })

  it('emits stderr as an error frame instead of swallowing it', () => {
    const f = fakeChild()
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => f.child)
    const sent: string[] = []
    d.onFrame((s) => sent.push(s))
    d.send({ t: 'turn', text: 'q' })
    f.emitErr('boom\n')
    expect(frames(sent).find((x) => x.type === 'error')).toEqual({ type: 'error', message: 'boom' })
  })

  it('interrupt kills the active turn process', () => {
    const f = fakeChild()
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => f.child, { initialPrompt: 'q' })
    d.send({ t: 'interrupt' })
    expect(f.killSpy).toHaveBeenCalled()
  })

  it('kill forwards to the active child', () => {
    const f = fakeChild()
    const d = new PerTurnStreamDriver(new CodexReducer(clock), () => f.child, { initialPrompt: 'q' })
    d.kill('SIGTERM')
    expect(f.killSpy).toHaveBeenCalledWith('SIGTERM')
  })
})
