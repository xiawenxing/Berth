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

  it('image launches never put the prompt on the URL', () => {
    startFreshLaunch(baseInput({ freeText: 'look', images: [{ name: 's.png', dataUrl: 'data:image/png;base64,AAAA' }] }))
    expect(FakeWS.instances[0].url).not.toContain('prompt=')
  })

  it('resolves pending and resyncs from the prime socket on the launched frame', () => {
    const resolvePending = vi.fn()
    const resync = vi.fn()
    startFreshLaunch(baseInput({ freeText: 'do the thing', resolvePending, resync }))
    FakeWS.instances[0].emit('{"__berth":"launched","sessionId":"S1"}')
    expect(resolvePending).toHaveBeenCalledWith('tok-1', 'S1')
    expect(resync).toHaveBeenCalledTimes(1)
  })

  // ---- claude/coco: idle-gated submission (the fix) ----
  it('text-only (claude): waits for the composer to go IDLE, then pastes and Enters separately', () => {
    startFreshLaunch(baseInput({ freeText: 'do the thing' }))
    const ws = FakeWS.instances[0]
    expect(ws.url).not.toContain('prompt=')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`boot ${BRACKETED_PASTE_READY} prompt>`)
    vi.advanceTimersByTime(300)
    expect(ws.sent).toEqual([]) // marker seen but not idle yet → do NOT fire (the live-verify failure)
    vi.advanceTimersByTime(1500) // idle → paste (no Enter) then Enter as a separate write
    expect(ws.parsed()).toEqual([
      { t: 'i', d: '\x1b[200~do the thing\x1b[201~' },
      { t: 'i', d: '\r' },
    ])
  })

  it('image launch (claude): holds the prompt until the [Image attach chip, then pastes + Enters', () => {
    startFreshLaunch(baseInput({
      freeText: 'look at this',
      images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' }],
    }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    vi.advanceTimersByTime(1200) // idle → image goes out first
    expect(ws.parsed()).toEqual([{ t: 'img', name: 'shot.png', d: 'data:image/png;base64,AAAA' }])

    ws.emit('spinner redraw, still attaching') // NOT the attach chip
    vi.advanceTimersByTime(900)
    expect(ws.sent.length).toBe(1) // prompt held — this was the reported bug

    ws.emit('[Image #1] attached') // attach confirmation → release prompt, then Enter
    vi.advanceTimersByTime(1500)
    const m = ws.parsed()
    expect(m[1]).toEqual({ t: 'i', d: '\x1b[200~look at this\x1b[201~' })
    expect(m[2]).toEqual({ t: 'i', d: '\r' })
  })

  it('image-only launch (claude): image then Enter after attach, no paste', () => {
    startFreshLaunch(baseInput({ images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,BBBB' }] }))
    const ws = FakeWS.instances[0]
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    vi.advanceTimersByTime(1200)
    ws.emit('[Image #1]')
    vi.advanceTimersByTime(1200)
    expect(ws.parsed()).toEqual([
      { t: 'img', name: 'a.png', d: 'data:image/png;base64,BBBB' },
      { t: 'i', d: '\r' },
    ])
  })

  it('task launch (claude) with images: image → task note → Enter', () => {
    startFreshLaunch(baseInput({
      dest: 'task', taskTitle: 'Fix the crash', taskNote: 'repro on cold start', todoKey: 'todo-9',
      images: [{ name: 'log.png', dataUrl: 'data:image/png;base64,EEEE' }],
    }))
    const ws = FakeWS.instances[0]
    expect(ws.url).not.toContain('prompt=')
    ws.emit('{"__berth":"launched","sessionId":"S1"}')
    ws.emit(`ready ${BRACKETED_PASTE_READY}`)
    vi.advanceTimersByTime(1200)
    ws.emit('[Image #1]')
    vi.advanceTimersByTime(1500)
    const m = ws.parsed()
    expect(m[0]).toEqual({ t: 'img', name: 'log.png', d: 'data:image/png;base64,EEEE' })
    expect(m[1]).toEqual({ t: 'i', d: '\x1b[200~repro on cold start\x1b[201~' })
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

    it('a clean text launch traces armed → step_emit(paste) → step_emit(enter) → complete', () => {
      startFreshLaunch(baseInput({ freeText: 'do the thing' }))
      const ws = FakeWS.instances[0]
      ws.emit('{"__berth":"launched","sessionId":"S1"}')
      ws.emit(`boot ${BRACKETED_PASTE_READY} prompt>`)
      vi.advanceTimersByTime(1800) // idle → paste, then Enter, then finish
      const events = ft()
      expect(events.map((e) => e.event)).toEqual(['armed', 'step_emit', 'step_emit', 'complete'])
      expect(events[1]).toMatchObject({ step: 'paste', markerSeen: true })
      expect(events[2]).toMatchObject({ step: 'enter' })
    })

    it('records markerSeen=false when the bracketed-paste marker never shows (readiness misfire)', () => {
      startFreshLaunch(baseInput({ freeText: 'do the thing' }))
      const ws = FakeWS.instances[0]
      ws.emit('{"__berth":"launched","sessionId":"S1"}')
      // No marker ever emitted → readyGuard only trips on the 12s fallback → paste fires "blind".
      vi.advanceTimersByTime(12_500)
      const paste = ft().find((e) => e.event === 'step_emit' && e.step === 'paste')
      expect(paste).toBeTruthy()
      expect(paste!.markerSeen).toBe(false)
      expect(paste!.elapsedSinceStepMs as number).toBeGreaterThanOrEqual(12_000)
    })

    it('socket closing before the composer goes idle traces armed but NEVER complete (the silent drop)', () => {
      startFreshLaunch(baseInput({ freeText: 'do the thing' }))
      const ws = FakeWS.instances[0]
      ws.emit('{"__berth":"launched","sessionId":"S1"}')
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
