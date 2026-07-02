import { beforeEach, describe, expect, it, vi } from 'vitest'

const childSpawnCalls: any[] = []

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, _argv: string[], opts: any) => {
    childSpawnCalls.push(opts)
    return { stdout: null, stderr: null, stdin: null, on() {}, kill() {}, pid: 1 }
  },
}))
vi.mock('../src/pty/binaries', () => ({ resolveAgentBinary: () => '/bin/coco', codexHookTrustSupportOrWarm: () => true }))
vi.mock('../src/pty/trust', () => ({ ensureClaudeTrust: () => {}, ensureCodexTrust: () => {} }))
vi.mock('../src/pty/flag-gate', () => ({ gateArgvForBinary: (_c: string, _b: string, argv: string[]) => ({ argv, dropped: [] }), stripAllDegradable: (_c: string, argv: string[]) => ({ argv, dropped: [] }) }))
vi.mock('../src/server-address', () => ({ getLocalServerAddress: () => null }))
vi.mock('../src/pty/coco-hook', () => ({ ensureCocoBerthHook: vi.fn(), writeCocoContextPayload: (p: string) => `${p}.coco.json` }))

beforeEach(() => { childSpawnCalls.length = 0 })

describe('spawnPerTurn env', () => {
  it('passes Berth context to coco stream-json turns through the session_start hook payload', async () => {
    const { spawnPerTurn } = await import('../src/pty/launch')
    spawnPerTurn('coco', { cwd: process.cwd(), sessionId: 'sess-1', prompt: 'hello', resumeId: null, injectFile: '/tmp/manifest.txt' })
    expect(childSpawnCalls).toHaveLength(1)
    expect(childSpawnCalls[0].env.BERTH_CONTEXT_FILE).toBe('/tmp/manifest.txt.coco.json')
  })
})
