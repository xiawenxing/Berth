import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAgentIntegration, getAgentIntegrationStatus } from '../src/agent-integration'

let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'berth-integration-home-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('PATH', '/usr/bin:/bin')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('agent integration installer', () => {
  it('accepts an existing current berth CLI on PATH', () => {
    const bin = join(home, 'bin')
    mkdirSync(bin, { recursive: true })
    const fake = join(bin, 'berth')
    const current = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version
    writeFileSync(fake, `#!/bin/sh\necho ${current}\n`)
    chmodSync(fake, 0o755)
    vi.stubEnv('PATH', `${bin}:/usr/bin:/bin`)

    const status = getAgentIntegrationStatus()
    expect(status.cli.state).toBe('current')
    expect(status.cli.path).toBe(fake)
    expect(status.needsAction).toBe(false)
  })

  it('installs a managed CLI shim and current berth-tasks skill symlink', () => {
    const before = getAgentIntegrationStatus()
    expect(before.cli.state).toBe('missing')
    expect(before.skills.state).toBe('current')

    const claudeHome = join(home, '.claude')
    rmSync(claudeHome, { recursive: true, force: true })
    mkdirSync(claudeHome, { recursive: true })
    expect(getAgentIntegrationStatus().skills.state).toBe('missing')

    const result = installAgentIntegration()
    const cli = join(home, '.local', 'bin', 'berth')
    expect(result.cliPath).toBe(cli)
    expect(readFileSync(cli, 'utf8')).toContain(`BERTH_MANAGED_CLI_SHIM version=${result.status.currentVersion}`)
    expect(result.status.cli.state).toBe('current')

    const skill = join(home, '.claude', 'skills', 'berth-tasks')
    expect(existsSync(join(skill, 'SKILL.md'))).toBe(true)
    expect(lstatSync(skill).isSymbolicLink()).toBe(true)
    expect(realpathSync(skill)).toBe(realpathSync(join(process.cwd(), 'skills', 'berth-tasks')))
    expect(result.status.skills.state).toBe('current')
    expect(result.status.needsAction).toBe(false)
  })
})
