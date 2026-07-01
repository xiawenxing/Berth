import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const startSpy = vi.fn()
// prevent a real browser launch from openBrowser()
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => ({ unref() {}, on() {} }),
}))
vi.mock('../src/server/index', () => ({ start: startSpy }))

beforeEach(() => { vi.resetModules(); vi.stubGlobal('fetch', vi.fn()); startSpy.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('berth start idempotency', () => {
  it('reuses an already-running Berth server (no second start)', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ berth: true }) })
    const { runCli } = await import('../src/cli')
    await runCli(['start'], '0.0.0')
    expect(startSpy).not.toHaveBeenCalled()
  })
  it('starts normally when no server answers', async () => {
    ;(globalThis.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'))
    startSpy.mockResolvedValue({ port: 7777, hasWeb: false, server: { } })
    const { runCli } = await import('../src/cli')
    await runCli(['start'], '0.0.0')
    expect(startSpy).toHaveBeenCalled()
  })
})
