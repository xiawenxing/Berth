import { describe, it, expect } from 'vitest'
import { extractSemver, semverGte } from '../src/pty/availability'
import { seedAgentDefaults, setAgentConfig, getAgentConfig, type AgentEntry } from '../src/data/agent-config'

function memStore() {
  const m = new Map<string, string>()
  return { getSetting: (k: string) => m.get(k) ?? null, setSetting: (k: string, v: string) => void m.set(k, v) }
}

describe('seedAgentDefaults', () => {
  it('first run enables only ok CLIs', () => {
    const store = memStore()
    seedAgentDefaults(store, new Set(['claude'] as const))
    const list = getAgentConfig(store).list
    expect(list.find(a => a.cli === 'claude')!.enabled).toBe(true)
    expect(list.find(a => a.cli === 'codex')!.enabled).toBe(false)
    expect(list.find(a => a.cli === 'coco')!.enabled).toBe(false)
  })
  it('all-unavailable seeds an all-disabled list that survives readback', () => {
    const store = memStore()
    seedAgentDefaults(store, new Set())
    expect(getAgentConfig(store).list.every(a => !a.enabled)).toBe(true)
  })
  it('does nothing when a list is already stored', () => {
    const store = memStore()
    store.setSetting('agentList', JSON.stringify([{ cli: 'codex', enabled: true, model: null, safeMode: false }, { cli: 'claude', enabled: false, model: null, safeMode: false }, { cli: 'coco', enabled: false, model: null, safeMode: false }]))
    seedAgentDefaults(store, new Set(['claude'] as const))
    expect(getAgentConfig(store).list.find(a => a.cli === 'codex')!.enabled).toBe(true)
  })
})

describe('setAgentConfig with availability', () => {
  const full = (over: Partial<Record<'claude' | 'codex' | 'coco', boolean>>): AgentEntry[] =>
    (['claude', 'codex', 'coco'] as const).map(cli => ({ cli, enabled: over[cli] ?? false, model: null, safeMode: false }))

  it('rejects enabling a CLI that is not ok', () => {
    const store = memStore()
    expect(() => setAgentConfig(store, { list: full({ codex: true }) }, new Set(['claude'] as const)))
      .toThrow(/codex.*not available/i)
  })
  it('allows the enabled CLI when it is ok', () => {
    const store = memStore()
    const cfg = setAgentConfig(store, { list: full({ claude: true }) }, new Set(['claude'] as const))
    expect(cfg.list.find(a => a.cli === 'claude')!.enabled).toBe(true)
  })
  it('allows zero enabled only when nothing is ok', () => {
    const store = memStore()
    expect(() => setAgentConfig(store, { list: full({}) }, new Set())).not.toThrow()
    expect(() => setAgentConfig(store, { list: full({}) }, new Set(['claude'] as const))).toThrow(/at least one/i)
  })
})

describe('semver helpers', () => {
  it('extracts x.y.z from real --version output', () => {
    expect(extractSemver('codex-cli 0.139.0')).toBe('0.139.0')
    expect(extractSemver('2.1.4 (Claude Code)')).toBe('2.1.4')
    expect(extractSemver('no version here')).toBeNull()
  })
  it('compares semver with >= semantics', () => {
    expect(semverGte('0.139.0', '0.40.0')).toBe(true)
    expect(semverGte('0.40.0', '0.40.0')).toBe(true)
    expect(semverGte('0.39.9', '0.40.0')).toBe(false)
    expect(semverGte('1.0.0', '0.40.0')).toBe(true)
    expect(semverGte('2.0.0', '10.0.0')).toBe(false)
  })
})

import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectCli } from '../src/pty/availability'

// A fake binary that prints `out` for ANY args (so it answers both --version and --help).
function fakeBin(name: string, out: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-avail-'))
  const bin = join(dir, name)
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('detectCli', () => {
  it('reports missing when no binary resolves (coco pinned to ~/.local/bin)', async () => {
    // In CI/dev without coco installed this resolves missing; assert the shape, not a specific reason
    const s = await detectCli('coco')
    expect(s.cli).toBe('coco')
    expect(['missing', 'ok', 'unverified']).toContain(s.reason)
    if (s.reason === 'missing') expect(s.ok).toBe(false)
  }, 30_000)   // coco --help does a network/update check; allow up to 30 s

  it('codex at/above the floor is ok', async () => {
    const s = await detectCli('codex', fakeBin('codex', 'codex-cli 0.139.0'))
    expect(s.reason).toBe('ok')
    expect(s.ok).toBe(true)
    expect(s.version).toBe('0.139.0')
  })
  it('codex below the floor is outdated', async () => {
    const s = await detectCli('codex', fakeBin('codex', 'codex-cli 0.1.0'))
    expect(s.reason).toBe('outdated')
    expect(s.ok).toBe(false)
    expect(s.version).toBe('0.1.0')
  })
  it('codex with unparseable --version is unverified', async () => {
    const s = await detectCli('codex', fakeBin('codex', 'no semver here'))
    expect(s.reason).toBe('unverified')
    expect(s.ok).toBe(false)
  })
  it('a CLI with no resolved binary is missing', async () => {
    const s = await detectCli('codex', null)
    expect(s.reason).toBe('missing')
    expect(s.installed).toBe(false)
  })
})
