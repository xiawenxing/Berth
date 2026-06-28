import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerFile } from '../src/server-discovery'
import { getLocalServerAddress } from '../src/server/server-address'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-start-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('start() wiring', () => {
  it('records the address and writes server.json on listen, removes it on close', async () => {
    const { start } = await import('../src/server/index')
    const { port, server } = await start(0, '127.0.0.1') as any
    expect(getLocalServerAddress()).toEqual({ port, host: '127.0.0.1' })
    expect(readServerFile()!.port).toBe(port)
    await new Promise<void>(r => server.close(() => r()))
    expect(readServerFile()).toBeNull()
  }, 30000)
})
