import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { listenWithFallback } from '../src/server/listen'

const open: Server[] = []
function track(s: Server): Server { open.push(s); return s }
afterEach(() => { for (const s of open) { try { s.close() } catch {} } open.length = 0 })

/** Grab a currently-free port by binding :0, reading it, then closing. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port
      s.close(() => resolve(p))
    })
  })
}

describe('listenWithFallback', () => {
  it('binds the preferred port when it is free', async () => {
    const port = await freePort()
    const s = track(createServer())
    const bound = await listenWithFallback(s, port, '127.0.0.1')
    expect(bound).toBe(port)
    expect((s.address() as any).port).toBe(port)
  })

  it('falls back to a free OS port when the preferred port is taken', async () => {
    const port = await freePort()
    const blocker = track(createServer())
    await new Promise<void>((res) => blocker.listen(port, '127.0.0.1', () => res()))

    const s = track(createServer())
    const bound = await listenWithFallback(s, port, '127.0.0.1')
    expect(bound).not.toBe(port)
    expect(bound).toBeGreaterThan(0)
    expect((s.address() as any).port).toBe(bound)
  })

  it('rejects on a non-EADDRINUSE error instead of falling back', async () => {
    const s = track(createServer())
    // An out-of-range port triggers a RangeError-class failure, not EADDRINUSE.
    await expect(listenWithFallback(s, 70000, '127.0.0.1')).rejects.toBeTruthy()
  })

  it('rejects on EADDRINUSE (does NOT relocate) when fallback is disabled', async () => {
    const port = await freePort()
    const blocker = track(createServer())
    await new Promise<void>((res) => blocker.listen(port, '127.0.0.1', () => res()))

    const s = track(createServer())
    // allowFallback=false → an explicit-port conflict must surface as an error, not a silent random port.
    await expect(listenWithFallback(s, port, '127.0.0.1', false)).rejects.toBeTruthy()
  })
})
