import { describe, it, expect, vi } from 'vitest'
import { bracketedPaste, autoSubmitWhenReady, BRACKETED_PASTE_ENABLE } from '../src/server/auto-submit-prompt'

// A fake node-pty exposing just the surface autoSubmitWhenReady needs (onData/onExit/write) plus
// emit/exit helpers and dispose tracking so the test can drive readiness and assert listener cleanup.
function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  const disposed = { data: false, exit: false }
  return {
    onData: (cb: any) => { dataCb = cb; return { dispose() { disposed.data = true } } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() { disposed.exit = true } } },
    write: vi.fn(),
    emit: (d: string) => dataCb(d),
    exit: () => exitCb(),
    disposed,
  }
}

// A controllable clock so the timeout fallback is deterministic.
function fakeClock() {
  let fn: (() => void) | null = null
  return {
    clock: {
      setTimeout: (f: () => void, _ms: number) => { fn = f; return 1 },
      clearTimeout: (_h: unknown) => { fn = null },
    },
    fire: () => { const f = fn; fn = null; f?.() },
    pending: () => fn != null,
  }
}

describe('bracketedPaste', () => {
  it('wraps the prompt in paste markers and a trailing Enter, mapping newlines to CR', () => {
    expect(bracketedPaste('hi')).toBe('\x1b[200~hi\x1b[201~\r')
    expect(bracketedPaste('a\nb')).toBe('\x1b[200~a\rb\x1b[201~\r')
    expect(bracketedPaste('a\r\nb')).toBe('\x1b[200~a\rb\x1b[201~\r')
  })
})

describe('autoSubmitWhenReady', () => {
  it('does not type the prompt until the CLI enables bracketed paste', () => {
    const pty = fakePty()
    autoSubmitWhenReady(pty as any, 'go', { clock: fakeClock().clock })
    pty.emit('booting up...\r\n')      // ordinary startup output, no readiness marker yet
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('types the prompt exactly once after the readiness marker, then stops listening', () => {
    const pty = fakePty()
    autoSubmitWhenReady(pty as any, 'go', { clock: fakeClock().clock })
    pty.emit('starting')
    pty.emit(BRACKETED_PASTE_ENABLE)   // CLI is ready for input
    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.write).toHaveBeenCalledWith(bracketedPaste('go'))
    expect(pty.disposed.data).toBe(true)   // listener cleaned up
    pty.emit(BRACKETED_PASTE_ENABLE)       // a second marker must not re-submit
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('detects the marker even when it is split across two data chunks', () => {
    const pty = fakePty()
    autoSubmitWhenReady(pty as any, 'go', { clock: fakeClock().clock })
    pty.emit('\x1b[?20')
    pty.emit('04h')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('types the prompt as a best-effort fallback when readiness never arrives (timeout)', () => {
    const pty = fakePty()
    const c = fakeClock()
    autoSubmitWhenReady(pty as any, 'go', { clock: c.clock })
    expect(pty.write).not.toHaveBeenCalled()
    c.fire()   // timeout elapses with no marker seen
    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.write).toHaveBeenCalledWith(bracketedPaste('go'))
  })

  it('does not type after the pty exits before becoming ready, and clears the timer', () => {
    const pty = fakePty()
    const c = fakeClock()
    autoSubmitWhenReady(pty as any, 'go', { clock: c.clock })
    pty.exit()
    expect(pty.write).not.toHaveBeenCalled()
    expect(c.pending()).toBe(false)        // timer cancelled on exit
    pty.emit(BRACKETED_PASTE_ENABLE)       // late marker after exit must not type
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('cancel() stops a pending submission', () => {
    const pty = fakePty()
    const cancel = autoSubmitWhenReady(pty as any, 'go', { clock: fakeClock().clock })
    cancel()
    pty.emit(BRACKETED_PASTE_ENABLE)
    expect(pty.write).not.toHaveBeenCalled()
  })
})
