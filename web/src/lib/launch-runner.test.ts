import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFreshLaunch, type StartFreshLaunchInput } from './launch-runner'
import * as diag from './diag'

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
  onclose: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.readyState = 3 }
  emit(data: string) { this.onmessage?.({ data }) }
  parsed() { return this.sent.map((s) => JSON.parse(s)) }
  kinds() { return this.parsed().map((m) => m.t) }
}

const BRACKETED_PASTE_READY = '\x1b[?2004h'

function fakeLocalStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, String(value)) }),
  }
}

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
  vi.stubGlobal('localStorage', fakeLocalStorage())
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('startFreshLaunch — first-turn delivery', () => {
  // ---- URL routing (who carries the prompt) ----
  it('text-only (codex, free): keeps the native URL positional (codex submit is reliable)', () => {
    startFreshLaunch(baseInput({ cli: 'codex', freeText: 'do the thing' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('prompt=do+the+thing')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    vi.advanceTimersByTime(2000)
    expect(ws.sent).toEqual([]) // server fired the URL positional; socket pushes nothing
  })

  it('text-only (task): keeps the URL positional so it composes with the task directive', () => {
    startFreshLaunch(baseInput({ dest: 'task', taskTitle: 'T', taskNote: 'do the thing', todoKey: 'todo-1' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('prompt=do+the+thing')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    vi.advanceTimersByTime(2000)
    expect(ws.sent).toEqual([])
  })

  it('image launches send prompt to the server for merging but defer URL positional submission', () => {
    startFreshLaunch(baseInput({ freeText: 'look', images: [{ name: 's.png', dataUrl: 'data:image/png;base64,AAAA' }] }))
    expect(FakeWS.instances[0].url).toContain('deferInitialPrompt=1')
    expect(FakeWS.instances[0].url).toContain('prompt=look')
  })

  it('resolves pending and resyncs from the prime socket on the launched frame', () => {
    const resolvePending = vi.fn()
    const resync = vi.fn()
    startFreshLaunch(baseInput({ freeText: 'do the thing', resolvePending, resync }))
    FakeWS.instances[0].emit('{"__berth":"launched","sessionId":"S1"}')
    expect(resolvePending).toHaveBeenCalledWith('tok-1', 'S1')
    expect(resync).toHaveBeenCalledTimes(1)
  })

  // ---- claude/coco free launches: default to Model B (race-free first turn) ----
  it('text-only (claude free): defaults to Model B instead of prime-socket paste', () => {
    startFreshLaunch(baseInput({ freeText: 'do the thing' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('render=stream-json')
    expect(ws.url).toContain('prompt=do+the+thing')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`boot ${BRACKETED_PASTE_READY} prompt>`)
    vi.advanceTimersByTime(2000)
    expect(ws.sent).toEqual([]) // server-side stream driver owns the first turn
  })

  it('text-only (coco free): defaults to Model B instead of prime-socket paste', () => {
    startFreshLaunch(baseInput({ cli: 'coco', freeText: 'do the thing' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('render=stream-json')
    expect(ws.url).toContain('prompt=do+the+thing')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`boot ${BRACKETED_PASTE_READY} prompt>`)
    vi.advanceTimersByTime(2000)
    expect(ws.sent).toEqual([])
  })

  it('image launch (claude free): sends one structured Model B turn on launch', () => {
    startFreshLaunch(baseInput({
      freeText: 'look at this',
      images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' }],
    }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('render=stream-json')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    expect(ws.parsed()).toEqual([
      { t: 'turn', text: 'look at this', images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' }], clientTurnId: 'launch_tok-1' },
    ])
  })

  it('image-only launch (claude free): sends one structured Model B image turn', () => {
    startFreshLaunch(baseInput({ images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,BBBB' }] }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('render=stream-json')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    expect(ws.parsed()).toEqual([
      { t: 'turn', text: '', images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,BBBB' }], clientTurnId: 'launch_tok-1' },
    ])
  })

  it('task launch (claude) with images: image → task note → Enter', () => {
    startFreshLaunch(baseInput({
      dest: 'task', taskTitle: 'Fix the crash', taskNote: 'repro on cold start', todoKey: 'todo-9',
      images: [{ name: 'log.png', dataUrl: 'data:image/png;base64,EEEE' }],
    }))
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('deferInitialPrompt=1')
    expect(ws.url).toContain('prompt=repro+on+cold+start')
    ws.emit(JSON.stringify({
      __berth: 'launched',
      sessionId: 'S1',
      deferredInitialPrompt: 'Please start working on the task: "Fix the crash"\n\nAdditional notes for this session:\nrepro on cold start',
    }))
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    vi.advanceTimersByTime(1200)
    ws.emit('[Image #1]')
    vi.advanceTimersByTime(1500)
    const m = ws.parsed()
    expect(m[0]).toEqual({ t: 'img', name: 'log.png', d: 'data:image/png;base64,EEEE' })
    expect(m[1]).toEqual({ t: 'i', d: '\x1b[200~Please start working on the task: "Fix the crash"\r\rAdditional notes for this session:\rrepro on cold start\x1b[201~' })
    expect(m[2]).toEqual({ t: 'i', d: '\r' })
  })

  // ---- first-turn delivery tracing (so the intermittent "title generated but query dropped" bug
  //      stops being invisible — every launch now leaves a correlated firstturn timeline) ----
  describe('diagnostics', () => {
    const ft = (): Array<Record<string, unknown> & { event: string }> =>
      (diag.logDiag as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter((c) => c[0] === 'firstturn')
        .map((c) => ({ event: c[1] as string, ...(c[2] as Record<string, unknown>) }))

    beforeEach(() => { vi.spyOn(diag, 'logDiag') })

    it('a clean task image launch traces armed → images → paste → enter → complete', () => {
      startFreshLaunch(baseInput({
        dest: 'task', taskTitle: 'Fix the crash', taskNote: 'do the thing', todoKey: 'todo-1',
        images: [{ name: 'log.png', dataUrl: 'data:image/png;base64,EEEE' }],
      }))
      const ws = FakeWS.instances[0]
      ws.emit(JSON.stringify({ __berth: 'launched', sessionId: 'S1', deferredInitialPrompt: 'Please start working\n\nAdditional notes:\ndo the thing' }))
      ws.emit(`boot ${BRACKETED_PASTE_READY} prompt>`)
      vi.advanceTimersByTime(1200)
      ws.emit('[Image #1]')
      vi.advanceTimersByTime(1800)
      const events = ft()
      expect(events.map((e) => e.event)).toEqual(['armed', 'step_emit', 'step_emit', 'step_emit', 'complete'])
      expect(events[1]).toMatchObject({ step: 'images', markerSeen: true })
      expect(events[2]).toMatchObject({ step: 'paste' })
      expect(events[3]).toMatchObject({ step: 'enter' })
    })

    it('records markerSeen=false when the bracketed-paste marker never shows (readiness misfire)', () => {
      startFreshLaunch(baseInput({
        dest: 'task', taskTitle: 'Fix the crash', taskNote: 'do the thing', todoKey: 'todo-1',
        images: [{ name: 'log.png', dataUrl: 'data:image/png;base64,EEEE' }],
      }))
      const ws = FakeWS.instances[0]
      ws.emit(JSON.stringify({ __berth: 'launched', sessionId: 'S1', deferredInitialPrompt: 'Please start working' }))
      // No marker ever emitted → readyGuard only trips on the 12s fallback → paste fires "blind".
      vi.advanceTimersByTime(12_500)
      const images = ft().find((e) => e.event === 'step_emit' && e.step === 'images')
      expect(images).toBeTruthy()
      expect(images!.markerSeen).toBe(false)
      expect(images!.elapsedSinceStepMs as number).toBeGreaterThanOrEqual(12_000)
    })

    it('socket closing before the composer goes idle traces armed but NEVER complete (the silent drop)', () => {
      startFreshLaunch(baseInput({
        dest: 'task', taskTitle: 'Fix the crash', taskNote: 'do the thing', todoKey: 'todo-1',
        images: [{ name: 'log.png', dataUrl: 'data:image/png;base64,EEEE' }],
      }))
      const ws = FakeWS.instances[0]
      ws.emit(JSON.stringify({ __berth: 'launched', sessionId: 'S1', deferredInitialPrompt: 'Please start working' }))
      ws.close() // drawer/network/server tore the prime socket down before the stepper could fire
      vi.advanceTimersByTime(60_500) // let the safety timeout run
      const events = ft().map((e) => e.event)
      expect(events).toContain('armed')
      expect(events).toContain('timeout')
      expect(events).not.toContain('complete') // the query was never delivered — and now we can SEE it
    })
  })

  // ---- legacy + Model B paths unchanged ----
  it('image launch (codex): legacy marker path — image on marker, prompt on the ack frame', () => {
    startFreshLaunch(baseInput({ cli: 'codex', freeText: 'analyze', images: [{ name: 'p.png', dataUrl: 'data:image/png;base64,DDDD' }] }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    expect(ws.kinds()).toEqual(['img']) // sync on the marker (codex behavior preserved)
    ws.emit('[Image #1]')
    expect(ws.kinds()).toEqual(['img', 'i'])
  })

  it('image launch (Model B / stream): one structured turn on the launched frame', () => {
    localStorage.setItem('berth-render-mode', 'B')
    startFreshLaunch(baseInput({ freeText: 'describe it', images: [{ name: 'b.png', dataUrl: 'data:image/png;base64,CCCC' }] }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    const msg = JSON.parse(ws.sent[0])
    expect(msg.t).toBe('turn')
    expect(msg.text).toBe('describe it')
    expect(msg.images).toEqual([{ name: 'b.png', dataUrl: 'data:image/png;base64,CCCC' }])
  })
})
