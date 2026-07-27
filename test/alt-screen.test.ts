import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AltScreenFilter, stripAltScreen } from '../src/server/alt-screen'
import { registerPty, attachViewer, killAllPtys } from '../src/server/pty-registry'

const ENTER = '\x1b[?1049h'
const EXIT = '\x1b[?1049l'
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h'

describe('stripAltScreen', () => {
  it('removes every flavour of alternate-buffer switch', () => {
    expect(stripAltScreen(`hi${ENTER}there`)).toBe('hithere')
    expect(stripAltScreen(`${ENTER}x${EXIT}y`)).toBe('xy')
    expect(stripAltScreen('\x1b[?1047h')).toBe('')
    expect(stripAltScreen('\x1b[?47l')).toBe('')
  })

  it('leaves every other DEC private mode alone, including alongside an alt-screen param', () => {
    // Mouse tracking + bracketed paste must survive — only the buffer switch is Berth's business.
    expect(stripAltScreen(MOUSE_ON + '\x1b[?2004h')).toBe(MOUSE_ON + '\x1b[?2004h')
    expect(stripAltScreen('\x1b[?1049;1002;1006h')).toBe('\x1b[?1002;1006h')
  })

  it('leaves ordinary output untouched', () => {
    expect(stripAltScreen('plain text, no escapes')).toBe('plain text, no escapes')
    expect(stripAltScreen('\x1b[2J\x1b[H\x1b[0mcolored')).toBe('\x1b[2J\x1b[H\x1b[0mcolored')
  })

  // The real-world failure: a 21 MB spool whose tail held two enters and zero exits, because the CLI
  // was killed while a full-screen view was up. Replaying it stranded every viewer in the empty
  // alternate buffer, permanently — a tail cut anywhere must still replay into the main buffer.
  it('normalizes a truncated tail whose enter has no matching exit', () => {
    const tail = `…earlier transcript…${ENTER}\x1b[2J\x1b[Hfull-screen view`
    expect(stripAltScreen(tail)).toBe('…earlier transcript…\x1b[2J\x1b[Hfull-screen view')
  })
})

describe('AltScreenFilter', () => {
  it('strips across chunks', () => {
    const f = new AltScreenFilter()
    expect(f.push('a')).toBe('a')
    expect(f.push(`${ENTER}b${MOUSE_ON}`)).toBe('b' + MOUSE_ON)
    expect(f.push(`c${EXIT}`)).toBe('c')
  })

  it('reassembles an escape sequence split across a chunk boundary', () => {
    const f = new AltScreenFilter()
    expect(f.push('x\x1b[?104')).toBe('x')      // partial held back, not leaked as visible garbage
    expect(f.push('9hy')).toBe('y')             // completed on the next chunk → recognized and stripped
  })

  it('releases a held-back partial sequence on flush', () => {
    const f = new AltScreenFilter()
    expect(f.push('x\x1b[0')).toBe('x')
    expect(f.flush()).toBe('\x1b[0')
    expect(f.flush()).toBe('')
  })
})

// ── driver ↔ registry wiring ────────────────────────────────────────────────────────────────────
const origBerthHome = process.env.BERTH_HOME
let testHome = ''

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'berth-alt-screen-'))
  process.env.BERTH_HOME = testHome
})

afterEach(() => {
  killAllPtys()
  if (origBerthHome === undefined) delete process.env.BERTH_HOME
  else process.env.BERTH_HOME = origBerthHome
  if (testHome) rmSync(testHome, { recursive: true, force: true })
})

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  return {
    pid: 4242,
    onData: (cb: any) => { dataCb = cb; return { dispose() {} } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() {} } },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    emit: (d: string) => dataCb(d),
  } as any
}

function fakeWs() {
  const sent: string[] = []
  return { sent, send: (d: string) => sent.push(d), close: vi.fn(), on: () => {} } as any
}

describe('alt-screen over the pty registry', () => {
  it('never sends the buffer switch to a live viewer, but forwards everything else', () => {
    const pty = fakePty()
    registerPty('s1', pty)
    const ws = fakeWs()
    attachViewer('s1', ws)
    ws.sent.length = 0

    pty.emit(`${ENTER}\x1b[2J${MOUSE_ON}full screen`)
    expect(ws.sent.join('')).toBe(`\x1b[2J${MOUSE_ON}full screen`)
  })

  it('replays a stuck spool into the main buffer', () => {
    const pty = fakePty()
    registerPty('s2', pty)
    pty.emit(`transcript${ENTER}full-screen view`)   // enter, never exited — the poisoned-spool shape

    const ws = fakeWs()
    attachViewer('s2', ws)
    const replay = ws.sent.join('')
    expect(replay).toContain('transcript')
    expect(replay).toContain('full-screen view')
    expect(replay).not.toContain(ENTER)
  })
})
