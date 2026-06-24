import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  registerPty, attachViewer, killPty, rekeyPty,
  subscribeActivity, snapshotActivity, IDLE_MS,
} from '../src/server/pty-registry'

const origBerthHome = process.env.BERTH_HOME
let testHome = ''

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'berth-pty-activity-'))
  process.env.BERTH_HOME = testHome
})

afterEach(() => {
  if (origBerthHome === undefined) delete process.env.BERTH_HOME
  else process.env.BERTH_HOME = origBerthHome
  if (testHome) rmSync(testHome, { recursive: true, force: true })
})

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  return {
    onData: (cb: any) => { dataCb = cb; return { dispose() {} } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() {} } },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    emit: (d: string) => dataCb(d), exit: () => exitCb(),
  } as any
}
function fakeWs() {
  let msgCb: (raw: any) => void = () => {}
  return {
    send: vi.fn(), close: vi.fn(),
    on: (ev: string, cb: any) => { if (ev === 'message') msgCb = cb },
    recv: (obj: any) => msgCb(JSON.stringify(obj)),
  } as any
}

describe('pty-registry → activity wiring', () => {
  it('emits running when a pty is registered as a turn (fresh launch with a prompt)', () => {
    const events: any[] = []
    const off = subscribeActivity(e => events.push(e))
    registerPty('act-1', fakePty(), { running: true })
    expect(events).toContainEqual({ kind: 'state', sessionId: 'act-1', state: 'running' })
    expect(snapshotActivity()).toContainEqual({ sessionId: 'act-1', state: 'running' })
    off(); killPty('act-1')
  })

  it('a passive register (resume / open-to-view) shows NO activity, even as the CLI redraws', () => {
    const pty = fakePty()
    registerPty('act-resume', pty)            // no { running } → opening a session, not a turn
    const events: any[] = []
    const off = subscribeActivity(e => events.push(e))
    pty.emit('\x1b[2J full screen redraw of the conversation')  // resume output
    pty.emit('more redraw')
    expect(events).toEqual([])                                  // ← the bug: must NOT spin/settle
    expect(snapshotActivity().find(s => s.sessionId === 'act-resume')).toBeUndefined()
    off(); killPty('act-resume')
  })

  it('does not re-emit running on every output chunk while already running', () => {
    const pty = fakePty(); registerPty('act-2b', pty, { running: true })
    const events: any[] = []
    const off = subscribeActivity(e => events.push(e))
    pty.emit('aaa'); pty.emit('bbb')
    expect(events.filter(e => e.sessionId === 'act-2b' && e.state === 'running')).toHaveLength(0)
    off(); killPty('act-2b')
  })

  it('emits exited when a running pty exits', () => {
    const pty = fakePty(); registerPty('act-3', pty, { running: true })
    const events: any[] = []
    const off = subscribeActivity(e => events.push(e))
    pty.exit()
    expect(events).toContainEqual({ kind: 'state', sessionId: 'act-3', state: 'exited' })
    off()
  })

  it('emits a rekey event when a codex session is rebound', () => {
    registerPty('act-intent', fakePty(), { running: true })
    const events: any[] = []
    const off = subscribeActivity(e => events.push(e))
    rekeyPty('act-intent', 'act-real')
    expect(events).toContainEqual({ kind: 'rekey', from: 'act-intent', to: 'act-real' })
    off(); killPty('act-real')
  })

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('a running turn settles after IDLE_MS, then an Enter-terminated input revives it', () => {
      const pty = fakePty(); registerPty('act-5', pty, { running: true })
      const events: any[] = []
      const off = subscribeActivity(e => events.push(e))

      vi.advanceTimersByTime(IDLE_MS)
      expect(events).toContainEqual({ kind: 'state', sessionId: 'act-5', state: 'settled' })

      const ws = fakeWs(); attachViewer('act-5', ws)
      events.length = 0
      ws.recv({ t: 'i', d: 'go\r' })
      expect(events).toContainEqual({ kind: 'state', sessionId: 'act-5', state: 'running' })
      off(); killPty('act-5')
    })

    it('typing into a resumed idle session starts a turn (the user actually interacts)', () => {
      const pty = fakePty(); registerPty('act-6', pty)   // resumed, idle
      const ws = fakeWs(); attachViewer('act-6', ws)
      const events: any[] = []
      const off = subscribeActivity(e => events.push(e))
      ws.recv({ t: 'i', d: 'do it\r' })
      expect(events).toContainEqual({ kind: 'state', sessionId: 'act-6', state: 'running' })
      off(); killPty('act-6')
    })

    it('does NOT count a repaint caused by Berth\'s own resize as activity', () => {
      const pty = fakePty(); registerPty('act-rz', pty, { running: true })
      vi.advanceTimersByTime(IDLE_MS)                          // settled
      const ws = fakeWs(); attachViewer('act-rz', ws)
      const events: any[] = []
      const off = subscribeActivity(e => events.push(e))

      ws.recv({ t: 'r', c: 100, r: 30 })                       // Berth fits the terminal → resize
      pty.emit('full-screen repaint with visible text')        // the resize-induced repaint (has content!)
      expect(events).toEqual([])                               // ← must NOT flip to running (no spinner flash)

      vi.advanceTimersByTime(600)                              // past the resize-quiet window
      pty.emit('genuine new agent output')                     // real output still revives the turn
      expect(events).toContainEqual({ kind: 'state', sessionId: 'act-rz', state: 'running' })
      off(); killPty('act-rz')
    })

    it('a settled session is NOT revived by an idle cursor-repaint (escape-only output)', () => {
      const pty = fakePty(); registerPty('act-7', pty, { running: true })
      vi.advanceTimersByTime(IDLE_MS)                          // settled
      const events: any[] = []
      const off = subscribeActivity(e => events.push(e))

      pty.emit('\x1b[?25l\x1b[24;1H\x1b[?25h')                 // the ~10s idle redraw — NO content
      expect(events).toEqual([])                               // ← must NOT flip to running → no red dot
      vi.advanceTimersByTime(IDLE_MS)
      expect(events).toEqual([])                               // and no spurious settle either

      pty.emit('real new output')                              // genuine agent text DOES revive
      expect(events).toContainEqual({ kind: 'state', sessionId: 'act-7', state: 'running' })
      off(); killPty('act-7')
    })
  })
})
