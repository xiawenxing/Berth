import { describe, it, expect, vi } from 'vitest'
import { PerTurnStreamDriver } from '../src/server/per-turn-stream-driver'
import { CodexReducer } from '../src/agent/normalize/codex-reducer'
import type { ChildLike } from '../src/server/stream-json-driver'
import type { ChatFrame } from '../src/agent/normalize/chat-model'

function fakeChild(pid = 100) {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  const child: ChildLike = {
    pid,
    stdout: { on: (_e, cb) => { dataCb = cb } },
    stderr: { on: () => {} },
    stdin: { write: () => {} },
    on: (_e, cb) => { exitCb = cb },
    kill: vi.fn(),
  }
  return { child, emit: (s: string) => dataCb(s), exit: () => exitCb(), killSpy: child.kill as any }
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
