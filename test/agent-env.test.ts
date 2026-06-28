import { describe, it, expect } from 'vitest'
import { agentSpawnEnv } from '../src/pty/agent-env'

describe('agentSpawnEnv', () => {
  it('prepends the shim dir to PATH and sets BERTH_PORT/BERTH_HOST', () => {
    const out = agentSpawnEnv({ PATH: '/usr/bin' }, { port: 7777, host: '127.0.0.1', binDir: '/home/.berth/bin' })
    expect(out.PATH!.startsWith('/home/.berth/bin:')).toBe(true)
    expect(out.PATH).toContain('/usr/bin')
    expect(out.BERTH_PORT).toBe('7777')
    expect(out.BERTH_HOST).toBe('127.0.0.1')
  })
  it('does not mutate the input', () => {
    const env = { PATH: '/usr/bin' }
    agentSpawnEnv(env, { port: 1, host: 'h', binDir: '/b' })
    expect((env as any).BERTH_PORT).toBeUndefined()
  })
  it('no-ops the address injection when addr is null (still returns a usable env)', () => {
    const out = agentSpawnEnv({ PATH: '/usr/bin' }, null)
    expect(out.PATH).toBe('/usr/bin'); expect(out.BERTH_PORT).toBeUndefined()
  })
})
