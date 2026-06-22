import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { berthAgentCwd, berthHome, dataHome } from '../src/paths'

const orig = process.env.BERTH_HOME
const origTest = process.env.BERTH_TEST_HOME
afterEach(() => {
  if (orig === undefined) delete process.env.BERTH_HOME; else process.env.BERTH_HOME = orig
  if (origTest === undefined) delete process.env.BERTH_TEST_HOME; else process.env.BERTH_TEST_HOME = origTest
})

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

  it('derives from BERTH_TEST_HOME (clean first-run) when BERTH_HOME is unset', () => {
    delete process.env.BERTH_HOME
    process.env.BERTH_TEST_HOME = '/tmp/berth-clean'
    expect(berthHome()).toBe(join('/tmp/berth-clean', '.berth'))
  })

  it('lets an explicit BERTH_HOME win over BERTH_TEST_HOME', () => {
    process.env.BERTH_HOME = '/tmp/berth-explicit'
    process.env.BERTH_TEST_HOME = '/tmp/berth-clean'
    expect(berthHome()).toBe('/tmp/berth-explicit')
  })
})

describe('dataHome', () => {
  it('defaults to the real homedir', () => {
    delete process.env.BERTH_TEST_HOME
    expect(dataHome()).toBe(homedir())
  })

  it('honors BERTH_TEST_HOME so data/session paths point at a clean test dir', () => {
    process.env.BERTH_TEST_HOME = '/tmp/berth-clean'
    expect(dataHome()).toBe('/tmp/berth-clean')
  })

  it('treats an empty BERTH_TEST_HOME as unset (falls back to homedir)', () => {
    process.env.BERTH_TEST_HOME = ''
    expect(dataHome()).toBe(homedir())
  })
})
