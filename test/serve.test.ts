import { describe, it, expect, vi } from 'vitest'
import { serveOrReuse } from '../src/serve'
import type { ServerAddress } from '../src/server-discovery'

function harness(opts: { reusable?: ServerAddress | null; env?: Record<string, string | undefined> }) {
  const find = vi.fn(async (_pref: any, _deps?: any, _o?: any) => opts.reusable ?? null)
  const start = vi.fn(async () => ({ port: 7777 }))
  const logs: string[] = []
  const log = (m: string) => logs.push(m)
  return { find, start, log, logs, env: opts.env ?? {} }
}

describe('serveOrReuse', () => {
  it('reuses a running server instead of binding a second one (no start, no error)', async () => {
    const h = harness({ reusable: { host: '127.0.0.1', port: 7777 } })
    const r = await serveOrReuse({ find: h.find, start: h.start, log: h.log, env: h.env })

    expect(r).toEqual({ reused: true, port: 7777 })
    expect(h.start).not.toHaveBeenCalled()                  // the bug: it used to bind → EADDRINUSE
    expect(h.logs.join('\n')).toContain('已在运行')
    expect(h.logs.join('\n')).toContain('7777')
  })

  it('starts a fresh server when nothing reusable is found', async () => {
    const h = harness({ reusable: null })
    const r = await serveOrReuse({ find: h.find, start: h.start, log: h.log, env: h.env })

    expect(h.start).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ reused: false, port: 7777 })
  })

  it('uses EXACT discovery when PORT is explicitly set (honor the requested port)', async () => {
    const h = harness({ reusable: null, env: { PORT: '7790' } })
    await serveOrReuse({ find: h.find, start: h.start, log: h.log, env: h.env })

    const [pref, , optsArg] = h.find.mock.calls[0]
    expect(pref).toEqual({ host: '127.0.0.1', port: 7790 })
    expect(optsArg).toEqual({ exact: true })
  })

  it('uses LOOSE discovery (reuse any recorded server) when no PORT/HOST is set', async () => {
    const h = harness({ reusable: null })
    await serveOrReuse({ find: h.find, start: h.start, log: h.log, env: h.env })

    const [pref, , optsArg] = h.find.mock.calls[0]
    expect(pref).toEqual({ host: '127.0.0.1', port: 7777 })
    expect(optsArg).toEqual({ exact: false })
  })
})
