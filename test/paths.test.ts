import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { berthAgentCwd, berthHome } from '../src/paths'

const orig = process.env.BERTH_HOME
afterEach(() => { if (orig === undefined) delete process.env.BERTH_HOME; else process.env.BERTH_HOME = orig })

describe('berthHome', () => {
  it('defaults to ~/.berth', () => {
    delete process.env.BERTH_HOME
    expect(berthHome()).toBe(join(homedir(), '.berth'))
  })

  it('honors BERTH_HOME so a release can be tested against an isolated/empty data dir', () => {
    process.env.BERTH_HOME = '/tmp/berth-test-xyz'
    expect(berthHome()).toBe('/tmp/berth-test-xyz')
  })

  it('derives the internal agent cwd from BERTH_HOME', () => {
    process.env.BERTH_HOME = '/tmp/berth-test-xyz'
    expect(berthAgentCwd()).toBe('/tmp/berth-test-xyz/agent-cwd')
  })

  it('treats an empty BERTH_HOME as unset (falls back to ~/.berth)', () => {
    process.env.BERTH_HOME = ''
    expect(berthHome()).toBe(join(homedir(), '.berth'))
  })
})
