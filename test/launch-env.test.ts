import { describe, it, expect, vi, beforeEach } from 'vitest'
const spawnCalls: any[] = []
vi.mock('node-pty', () => ({ spawn: (_bin: string, _argv: string[], opts: any) => { spawnCalls.push(opts); return { onData(){}, onExit(){}, write(){}, kill(){}, pid: 1 } } }))
vi.mock('../src/pty/binaries', () => ({ resolveAgentBinary: () => '/bin/claude', codexHookTrustSupportOrWarm: () => true }))
vi.mock('../src/pty/trust', () => ({ ensureClaudeTrust: () => {}, ensureCodexTrust: () => {} }))
vi.mock('../src/pty/flag-gate', () => ({ gateArgvForBinary: (_c: string, _b: string, argv: string[]) => ({ argv, dropped: [] }), stripAllDegradable: (_c: string, argv: string[]) => ({ argv, dropped: [] }) }))
vi.mock('../src/server-address', () => ({ getLocalServerAddress: () => ({ port: 7777, host: '127.0.0.1' }) }))
vi.mock('../src/pty/agent-shim', () => ({ ensureAgentBerthShim: () => '/home/.berth/bin' }))

beforeEach(() => { spawnCalls.length = 0 })

describe('launch env injection', () => {
  it('resumeSession PTY env carries BERTH_PORT + shim PATH', async () => {
    const { resumeSession } = await import('../src/pty/launch')
    resumeSession({ sessionId: 's', cwd: process.cwd(), resume: { cli: 'claude', id: 'i' } } as any)
    const env = spawnCalls[0].env
    expect(env.BERTH_PORT).toBe('7777')
    expect(String(env.PATH).startsWith('/home/.berth/bin:')).toBe(true)
  })
})
