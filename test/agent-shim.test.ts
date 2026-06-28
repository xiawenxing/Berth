import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureAgentBerthShim } from '../src/server/agent-shim'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-shim-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('ensureAgentBerthShim', () => {
  it('writes an executable berth launcher and returns its dir', () => {
    const dir = ensureAgentBerthShim('/path/to/bin/berth.mjs')
    const shim = join(dir, 'berth')
    expect(dir).toBe(join(home, 'bin'))
    expect(statSync(shim).mode & 0o111).not.toBe(0)             // executable bit set
    const body = readFileSync(shim, 'utf8')
    expect(body).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(body).toContain('/path/to/bin/berth.mjs')
  })
  it('is idempotent (no rewrite when content matches)', () => {
    const d1 = ensureAgentBerthShim('/x/berth.mjs'); const d2 = ensureAgentBerthShim('/x/berth.mjs')
    expect(d1).toBe(d2)
  })
})
