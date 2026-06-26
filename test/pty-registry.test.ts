import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerPty, attachViewer, hasLivePty, killPty, killAllPtys, rekeyPty, liveCount } from '../src/server/pty-registry'
import { ptySpoolPath, readPtySpoolTail } from '../src/server/pty-spool'

const origBerthHome = process.env.BERTH_HOME
let testHome = ''

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'berth-pty-registry-'))
  process.env.BERTH_HOME = testHome
})

afterEach(() => {
  if (origBerthHome === undefined) delete process.env.BERTH_HOME
  else process.env.BERTH_HOME = origBerthHome
  if (testHome) rmSync(testHome, { recursive: true, force: true })
})

// Minimal fake IPty: capture onData/onExit callbacks, record writes/kills.
function fakePty(pid?: number) {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  return {
    pid,
    onData: (cb: any) => { dataCb = cb; return { dispose() {} } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() {} } },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emit: (d: string) => dataCb(d),
    exit: () => exitCb(),
  } as any
}

// Minimal fake ws: capture sent frames + the close handler.
function fakeWs() {
  const sent: string[] = []
  let closeCb: () => void = () => {}
  return {
    send: (d: string) => sent.push(d),
    close: vi.fn(),
    on: (ev: string, cb: any) => { if (ev === 'close') closeCb = cb },
    sent,
    triggerClose: () => closeCb(),
  } as any
}

describe('pty-registry', () => {
  it('keeps the pty alive after a viewer detaches, and replays scrollback on reattach', () => {
    const pty = fakePty()
    registerPty('sess-1', pty)
    expect(hasLivePty('sess-1')).toBe(true)

    const v1 = fakeWs()
    attachViewer('sess-1', v1)
    pty.emit('hello ')
    pty.emit('world')
    expect(v1.sent.join('')).toContain('hello world')

    // Viewer leaves — pty must NOT be killed.
    v1.triggerClose()
    expect(pty.kill).not.toHaveBeenCalled()
    expect(hasLivePty('sess-1')).toBe(true)

    // New viewer reattaches — gets the buffered scrollback immediately.
    const v2 = fakeWs()
    attachViewer('sess-1', v2)
    expect(v2.sent.join('')).toContain('hello world')
    killPty('sess-1')
  })

  it('persists raw pty bytes and replays the requested tail from disk', () => {
    const pty = fakePty()
    registerPty('spool-1', pty)
    pty.emit('aaa')
    pty.emit('bbb')

    expect(readPtySpoolTail('spool-1')).toBe('aaabbb')

    const ws = fakeWs()
    attachViewer('spool-1', ws, { replayBytes: 4 })
    expect(ws.sent.join('')).toBe('abbb')
    killPty('spool-1')
  })

  it('moves the raw pty spool when a live pty is rekeyed', () => {
    const pty = fakePty()
    registerPty('intent-spool', pty)
    pty.emit('before-bind')
    rekeyPty('intent-spool', 'real-spool')
    pty.emit('-after-bind')

    expect(readPtySpoolTail('real-spool')).toContain('before-bind-after-bind')
    expect(ptySpoolPath('real-spool')).not.toBe(ptySpoolPath('intent-spool'))
    killPty('real-spool')
  })

  it('forwards input and kill messages; broadcasts to multiple viewers', () => {
    const pty = fakePty()
    registerPty('sess-2', pty)
    const a = fakeWs(), b = fakeWs()
    attachViewer('sess-2', a)
    attachViewer('sess-2', b)
    pty.emit('X')
    expect(a.sent.join('')).toContain('X')
    expect(b.sent.join('')).toContain('X')
  })

  it('killPty stops the process and clears the entry', () => {
    const pty = fakePty()
    registerPty('sess-3', pty)
    killPty('sess-3')
    expect(pty.kill).toHaveBeenCalled()
    expect(hasLivePty('sess-3')).toBe(false)
  })

  it('pty exit removes it from the registry', () => {
    const pty = fakePty()
    registerPty('sess-4', pty)
    pty.exit()
    expect(hasLivePty('sess-4')).toBe(false)
  })

  it('rekeyPty moves a live pty to a new key (codex bind)', () => {
    const pty = fakePty()
    registerPty('intent-x', pty)
    rekeyPty('intent-x', 'real-codex-id')
    expect(hasLivePty('intent-x')).toBe(false)
    expect(hasLivePty('real-codex-id')).toBe(true)
    killPty('real-codex-id')
  })

  it('killPty signals the whole process group (negative pid), not just the leader pid', () => {
    // The agent's children (MCP servers, sub-node, ripgrep) share the agent's process group; a
    // single-pid SIGHUP leaks them. We must target the group via process.kill(-pid).
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true as any)
    try {
      const pty = fakePty(4242)
      registerPty('grp-kill', pty)
      killPty('grp-kill')
      expect(spy).toHaveBeenCalledWith(-4242, 'SIGTERM')
    } finally {
      spy.mockRestore()
    }
  })

  it('killAllPtys group-SIGKILLs on shutdown (synchronous, no grace timer)', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true as any)
    try {
      registerPty('shut-grp', fakePty(7373))
      killAllPtys()
      expect(spy).toHaveBeenCalledWith(-7373, 'SIGKILL')
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to the single-pid kill when the group send fails', () => {
    // Force the group send to throw so we exercise the fallback path — the path real code hits once
    // a pid is already gone (ESRCH).
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH') })
    try {
      const pty = fakePty(999)
      registerPty('fallback', pty)
      killPty('fallback')
      expect(pty.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      spy.mockRestore()
    }
  })

  it('killAllPtys kills every live pty and empties the registry (shutdown cleanup)', () => {
    const a = fakePty(), b = fakePty(), c = fakePty()
    registerPty('shut-a', a)
    registerPty('shut-b', b)
    registerPty('shut-c', c)
    expect(liveCount()).toBeGreaterThanOrEqual(3)
    killAllPtys()
    expect(a.kill).toHaveBeenCalled()
    expect(b.kill).toHaveBeenCalled()
    expect(c.kill).toHaveBeenCalled()
    expect(liveCount()).toBe(0)
  })

  it('registerPty calls opts.onExit when the pty exits', () => {
    let exitCb: () => void = () => {}
    const fakePty: any = { pid: 0, onData: () => {}, onExit: (cb: () => void) => { exitCb = cb }, kill: () => {} }
    let called = false
    registerPty('k-onexit', fakePty, { onExit: () => { called = true } })
    exitCb()
    expect(called).toBe(true)
  })
})
