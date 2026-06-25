import { describe, it, expect, vi, afterEach } from 'vitest'
import { TuiDriver } from '../src/server/tui-driver'

// Minimal fake IPty: capture onData/onExit, let the test drive emit/exit.
function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number }) => void = () => {}
  return {
    pid: 123,
    onData: (cb: any) => { dataCb = cb; return { dispose() {} } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() {} } },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    emit: (d: string) => dataCb(d),
    exit: (exitCode = 0) => exitCb({ exitCode }),
  } as any
}

describe('TuiDriver reactive respawn', () => {
  afterEach(() => vi.useRealTimers())

  it('re-spawns once on a fast nonzero exit and keeps the same driver alive', () => {
    const p1 = fakePty(); const p2 = fakePty()
    const respawn = vi.fn(() => p2)
    const frames: string[] = []; let exited = false
    const d = new TuiDriver(p1, 'k-retry', { respawn })
    d.onFrame((s) => frames.push(s)); d.onExit(() => { exited = true })

    p1.exit(1)                                   // fast fail → retry
    expect(respawn).toHaveBeenCalledTimes(1)
    expect(exited).toBe(false)                   // viewers never see a dead session
    expect(frames.join('')).toContain('retrying without advanced options')

    // The driver is now bound to p2 — its output flows through the same frame callback.
    p2.emit('hello from retry')
    expect(frames.join('')).toContain('hello from retry')
  })

  it('does not retry a second time — surfaces the failure after one retry', () => {
    const p1 = fakePty(); const p2 = fakePty()
    const d = new TuiDriver(p1, 'k-retry2', { respawn: () => p2 })
    const frames: string[] = []; let exited = false
    d.onFrame((s) => frames.push(s)); d.onExit(() => { exited = true })

    p1.exit(1)                                   // 1st fast fail → retry
    p2.exit(1)                                   // 2nd fast fail → no more retry
    expect(exited).toBe(true)
    expect(frames.join('')).toContain('exited during startup')
  })

  it('without a respawn, a fast fail surfaces the startup diagnostic', () => {
    const p = fakePty()
    const d = new TuiDriver(p, 'k-noretry')
    const frames: string[] = []; let exited = false
    d.onFrame((s) => frames.push(s)); d.onExit(() => { exited = true })

    p.exit(1)
    expect(exited).toBe(true)
    expect(frames.join('')).toContain('exited during startup')
  })

  it('a normal (slow) exit says "session ended", not the failure diagnostic', () => {
    vi.useFakeTimers()
    const p = fakePty()
    const d = new TuiDriver(p, 'k-normal', { respawn: () => fakePty() })
    const frames: string[] = []
    d.onFrame((s) => frames.push(s))
    p.emit('did real work')                      // visible output
    vi.advanceTimersByTime(5000)                 // well past FAST_FAIL_MS
    p.exit(0)
    expect(frames.join('')).toContain('session ended')
    expect(frames.join('')).not.toContain('retrying')
  })
})
