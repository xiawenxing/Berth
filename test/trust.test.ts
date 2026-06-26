import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTrustedProject, ensureClaudeTrust, withTrustedCodexProject, ensureCodexTrust } from '../src/pty/trust'

describe('withTrustedProject (pure)', () => {
  it('marks a brand-new project entry as trusted, creating projects map', () => {
    const cfg = withTrustedProject({ numStartups: 1 }, '/Users/me/repo')
    expect(cfg.projects['/Users/me/repo'].hasTrustDialogAccepted).toBe(true)
    expect(cfg.numStartups).toBe(1)
  })

  it('preserves the existing entry fields and sibling projects', () => {
    const input = {
      projects: {
        '/a': { hasTrustDialogAccepted: false, lastCost: 1.2, allowedTools: ['x'] },
        '/b': { hasTrustDialogAccepted: true },
      },
    }
    const cfg = withTrustedProject(input, '/a')
    expect(cfg.projects['/a'].hasTrustDialogAccepted).toBe(true)
    expect(cfg.projects['/a'].lastCost).toBe(1.2)
    expect(cfg.projects['/a'].allowedTools).toEqual(['x'])
    expect(cfg.projects['/b']).toEqual({ hasTrustDialogAccepted: true })
  })

  it('tolerates a junk/empty config', () => {
    expect(withTrustedProject(null as any, '/c').projects['/c'].hasTrustDialogAccepted).toBe(true)
    expect(withTrustedProject({ projects: 'nope' } as any, '/c').projects['/c'].hasTrustDialogAccepted).toBe(true)
  })
})

describe('ensureClaudeTrust (io)', () => {
  it('seeds the resolved real path and preserves the rest of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-trust-'))
    const real = realpathSync(dir)                       // macOS: /tmp → /private/tmp
    const cfgPath = join(dir, 'claude.json')
    writeFileSync(cfgPath, JSON.stringify({ numStartups: 7, projects: { '/x': { lastCost: 9 } } }, null, 2))

    ensureClaudeTrust(dir, cfgPath)

    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    expect(cfg.projects[real].hasTrustDialogAccepted).toBe(true)   // keyed by REAL path
    expect(cfg.projects['/x']).toEqual({ lastCost: 9 })            // untouched
    expect(cfg.numStartups).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  it('never throws when the config path is unwritable/missing dir', () => {
    expect(() => ensureClaudeTrust('/nonexistent-cwd-xyz', '/nonexistent-dir-xyz/claude.json')).not.toThrow()
  })
})

describe('withTrustedCodexProject (pure)', () => {
  it('appends a trusted project table to an empty / fresh config', () => {
    const out = withTrustedCodexProject('', '/Users/me/repo')
    expect(out).toContain('[projects."/Users/me/repo"]')
    expect(out).toContain('trust_level = "trusted"')
  })

  it('preserves existing content and other project tables when appending', () => {
    const input = '[model]\nname = "gpt"\n\n[projects."/a"]\ntrust_level = "trusted"\n'
    const out = withTrustedCodexProject(input, '/b')!
    expect(out).toContain('[model]')
    expect(out).toContain('[projects."/a"]')   // sibling untouched
    expect(out).toContain('[projects."/b"]')   // new one appended
  })

  it('returns null (no change) when the directory already has a project table', () => {
    const input = '[projects."/a"]\ntrust_level = "trusted"\n'
    expect(withTrustedCodexProject(input, '/a')).toBeNull()
  })
})

describe('ensureCodexTrust (io)', () => {
  it('seeds the resolved real path as a trusted table, preserving the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-codex-trust-'))
    const real = realpathSync(dir)
    const cfgPath = join(dir, 'config.toml')
    writeFileSync(cfgPath, '[notice]\nhide = true\n')

    ensureCodexTrust(dir, cfgPath)

    const toml = readFileSync(cfgPath, 'utf8')
    expect(toml).toContain('[notice]')                       // untouched
    expect(toml).toContain(`[projects."${real}"]`)           // keyed by REAL path
    expect(toml).toContain('trust_level = "trusted"')

    // Idempotent: a second call must not append a duplicate (invalid TOML).
    ensureCodexTrust(dir, cfgPath)
    const again = readFileSync(cfgPath, 'utf8')
    expect(again.match(/\[projects\./g)?.length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the config (and dir) when absent, and never throws', () => {
    const base = mkdtempSync(join(tmpdir(), 'berth-codex-trust2-'))
    const cfgPath = join(base, 'nested', 'config.toml')
    expect(() => ensureCodexTrust(base, cfgPath)).not.toThrow()
    expect(readFileSync(cfgPath, 'utf8')).toContain('trust_level = "trusted"')
    rmSync(base, { recursive: true, force: true })
  })
})
