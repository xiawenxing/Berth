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
  it('keeps the berth shim first and adds the resolved agent dir for env-node launchers', () => {
    const out = agentSpawnEnv(
      { PATH: '/usr/bin:/bin' },
      { port: 7777, host: '127.0.0.1', binDir: '/home/.berth/bin' },
      undefined,
      '/home/.nvm/versions/node/v20/bin',
    )
    expect(out.PATH).toBe('/home/.berth/bin:/home/.nvm/versions/node/v20/bin:/usr/bin:/bin')
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
  it('injects BERTH_SESSION_ID when a sessionId is given', () => {
    const env = agentSpawnEnv({}, null, 'sid-123')
    expect(env.BERTH_SESSION_ID).toBe('sid-123')
  })
  it('omits BERTH_SESSION_ID when no sessionId is given', () => {
    expect(agentSpawnEnv({}, null).BERTH_SESSION_ID).toBeUndefined()
    expect(agentSpawnEnv({}, null, '').BERTH_SESSION_ID).toBeUndefined()
  })
  it('still advertises the server address alongside the session id', () => {
    const env = agentSpawnEnv({}, { port: 7777, host: '127.0.0.1', binDir: '/bin' }, 'sid-9')
    expect(env.BERTH_PORT).toBe('7777')
    expect(env.BERTH_SESSION_ID).toBe('sid-9')
  })
  it('drops parent Codex run markers but keeps CODEX_HOME', () => {
    const env = agentSpawnEnv({
      CODEX_CI: '1',
      CODEX_THREAD_ID: 'parent-thread',
      CODEX_PARENT_THREAD_ID: 'grandparent-thread',
      CODEX_HOME: '/Users/me/.codex',
    }, null)
    expect(env.CODEX_CI).toBeUndefined()
    expect(env.CODEX_THREAD_ID).toBeUndefined()
    expect(env.CODEX_PARENT_THREAD_ID).toBeUndefined()
    expect(env.CODEX_HOME).toBe('/Users/me/.codex')
  })
})
