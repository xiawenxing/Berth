import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFreshLaunch, type StartFreshLaunchInput } from './launch-runner'

// A fake /pty WebSocket: records what the prime socket sends and lets the test drive inbound frames.
class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  url: string
  readyState = 1
  binaryType = ''
  bufferedAmount = 0
  sent: string[] = []
  closed = false
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.readyState = 3 }
  emit(data: string) { this.onmessage?.({ data }) }
}

const BRACKETED_PASTE_READY = '\x1b[?2004h'

function baseInput(overrides: Partial<StartFreshLaunchInput>): StartFreshLaunchInput {
  return {
    dest: 'free',
    title: 'test',
    cli: 'claude',
    cargo: null,
    sessions: [],
    addPending: vi.fn(),
    resolvePending: vi.fn(),
    openDrawer: vi.fn(),
    projectId: 'p1',
    makeLaunchToken: () => 'tok-1',
    now: () => 1000,
    ...overrides,
  }
}

beforeEach(() => {
  FakeWS.instances = []
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startFreshLaunch — drawer-independent launch submission', () => {
  it('prompt-only: puts the prompt in the URL and never submits over the socket', () => {
    startFreshLaunch(baseInput({ freeText: 'do the thing' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('prompt=do+the+thing')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    expect(ws.sent).toEqual([]) // server fired the URL prompt at spawn; nothing to push
  })

  it('image launch (TUI): submits images+prompt over the prime socket after bracketed-paste ready', () => {
    const resolvePending = vi.fn()
    startFreshLaunch(baseInput({
      freeText: 'look at this',
      images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' }],
      resolvePending,
    }))
    const ws = FakeWS.instances[0]
    // images can't ride the URL
    expect(ws.url).not.toContain('prompt=')

    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    expect(resolvePending).toHaveBeenCalledWith('tok-1', 'S1') // pending bound to the real id
    expect(ws.sent).toEqual([]) // not yet — CLI hasn't enabled bracketed paste

    ws.emit('some startup banner\r\n')
    expect(ws.sent).toEqual([]) // still waiting for the readiness marker

    ws.emit(`ready ${BRACKETED_PASTE_READY} prompt>`)
    const msgs = ws.sent.map((s) => JSON.parse(s))
    expect(msgs[0]).toEqual({ t: 'img', name: 'shot.png', d: 'data:image/png;base64,AAAA' })
    expect(msgs[1]).toEqual({ t: 'i', d: '\x1b[200~look at this\x1b[201~\r' })
  })

  it('image launch (TUI): submits exactly once even with more output', () => {
    startFreshLaunch(baseInput({
      freeText: 'hi',
      images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,BBBB' }],
    }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`x ${BRACKETED_PASTE_READY}`)
    const after = ws.sent.length
    ws.emit(`more ${BRACKETED_PASTE_READY} output`)
    expect(ws.sent.length).toBe(after) // no duplicate submission
  })

  it('image launch (Model B / stream): submits one structured turn on the launched frame', () => {
    localStorage.setItem('berth-render-mode', 'B')
    startFreshLaunch(baseInput({
      freeText: 'describe it',
      images: [{ name: 'b.png', dataUrl: 'data:image/png;base64,CCCC' }],
    }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    const msg = JSON.parse(ws.sent[0])
    expect(msg.t).toBe('turn')
    expect(msg.text).toBe('describe it')
    expect(msg.images).toEqual([{ name: 'b.png', dataUrl: 'data:image/png;base64,CCCC' }])
  })
})
