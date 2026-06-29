import { describe, it, expect } from 'vitest'
import { findReusableServer, probeHealth } from '../src/server-resolve'
import type { ServerAddress } from '../src/server-discovery'

const PREFERRED = { host: '127.0.0.1', port: 7777 }

function deps(opts: {
  record?: ServerAddress | null
  healthy?: Set<number>   // ports that answer /api/health with berth:true
}) {
  const healthy = opts.healthy ?? new Set<number>()
  return {
    read: () => opts.record ?? null,
    probe: async (_host: string, port: number) => healthy.has(port),
  }
}

describe('findReusableServer', () => {
  it('reuses the recorded server.json address when it is healthy (any port)', async () => {
    const rec = { host: '127.0.0.1', port: 58128 }
    const got = await findReusableServer(PREFERRED, deps({ record: rec, healthy: new Set([58128]) }))
    expect(got).toEqual(rec)
  })

  it('returns null when there is no record and the preferred port is not healthy', async () => {
    const got = await findReusableServer(PREFERRED, deps({ record: null, healthy: new Set() }))
    expect(got).toBeNull()
  })

  it('falls back to the preferred port when the record is missing but 7777 is a live Berth server', async () => {
    const got = await findReusableServer(PREFERRED, deps({ record: null, healthy: new Set([7777]) }))
    expect(got).toEqual({ host: '127.0.0.1', port: 7777 })
  })

  it('ignores a stale/unhealthy record and falls back to a healthy preferred port', async () => {
    const stale = { host: '127.0.0.1', port: 58128 }
    const got = await findReusableServer(PREFERRED, deps({ record: stale, healthy: new Set([7777]) }))
    expect(got).toEqual({ host: '127.0.0.1', port: 7777 })
  })

  it('returns null when both the recorded address and the preferred port are unhealthy', async () => {
    const stale = { host: '127.0.0.1', port: 58128 }
    const got = await findReusableServer(PREFERRED, deps({ record: stale, healthy: new Set() }))
    expect(got).toBeNull()
  })

  it('does not double-probe when the record already points at the preferred port', async () => {
    let probes = 0
    const rec = { host: '127.0.0.1', port: 7777 }
    const got = await findReusableServer(PREFERRED, {
      read: () => rec,
      probe: async () => { probes++; return false },
    })
    expect(got).toBeNull()
    expect(probes).toBe(1)   // recorded == preferred → probe once, not twice
  })
})

describe('probeHealth', () => {
  it('is true only when /api/health returns berth:true', async () => {
    const ok = await probeHealth('127.0.0.1', 7777, async () => ({ ok: true, json: async () => ({ berth: true }) }) as any)
    expect(ok).toBe(true)
  })

  it('is false when the body lacks berth:true', async () => {
    const no = await probeHealth('127.0.0.1', 7777, async () => ({ ok: true, json: async () => ({}) }) as any)
    expect(no).toBe(false)
  })

  it('is false (never throws) when the fetch rejects', async () => {
    const no = await probeHealth('127.0.0.1', 7777, async () => { throw new Error('ECONNREFUSED') })
    expect(no).toBe(false)
  })
})
