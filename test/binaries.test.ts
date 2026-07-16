import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firstUsableCandidate, codexHookTrustSupportCached, codexSupportsHookTrust, warmCodexHookTrustSupport, warmCliHelp, cliFlagSupportedCached, clearAgentBinaryCachesForTest } from '../src/pty/binaries'
import { resumeArgv } from '../src/pty/launch'
describe('binaries + argv', () => {
  it('finds coco from PATH or an explicit override while still requiring identity verification at launch', () => {
    const home = mkdtempSync(join(tmpdir(), 'berth-coco-home-'))
    const binDir = mkdtempSync(join(tmpdir(), 'berth-coco-bin-'))
    const coco = join(binDir, 'coco')
    writeFileSync(coco, '#!/bin/sh\nexit 0\n')
    chmodSync(coco, 0o755)
    expect(firstUsableCandidate('coco', { home, path: binDir, appCandidates: {} })).toBe(coco)
    expect(firstUsableCandidate('coco', { home, path: '', env: { BERTH_COCO_BIN: coco }, appCandidates: {} })).toBe(coco)
  })
  it('maps each cli to a resume argv template', () => {
    expect(resumeArgv('claude', 'U')).toEqual(['--resume', 'U'])
    expect(resumeArgv('codex', 'U')).toEqual(['resume', '--no-alt-screen', 'U'])
    expect(resumeArgv('coco', 'U')).toEqual(['--resume=U'])   // pflag optional-value: must use =id, see launch.test.ts
  })

  it('finds an NVM-installed codex when the parent PATH does not include NVM', () => {
    const home = mkdtempSync(join(tmpdir(), 'berth-nvm-home-'))
    const oldBin = join(home, '.nvm', 'versions', 'node', 'v20.20.0', 'bin')
    const newBin = join(home, '.nvm', 'versions', 'node', 'v22.17.1', 'bin')
    mkdirSync(oldBin, { recursive: true })
    mkdirSync(newBin, { recursive: true })
    const codex = join(oldBin, 'codex')
    writeFileSync(codex, '#!/bin/sh\nexit 0\n')
    chmodSync(codex, 0o755)

    expect(firstUsableCandidate('codex', { home, path: '', appCandidates: {} })).toBe(codex)
  })

  it('resolves PATH candidates to an executable absolute path and never returns a bare command', () => {
    const home = mkdtempSync(join(tmpdir(), 'berth-empty-home-'))
    const binDir = mkdtempSync(join(tmpdir(), 'berth-path-bin-'))
    const codex = join(binDir, 'codex')
    writeFileSync(codex, '#!/bin/sh\nexit 0\n')
    chmodSync(codex, 0o755)

    expect(firstUsableCandidate('codex', { home, path: binDir, appCandidates: {} })).toBe(codex)
    expect(firstUsableCandidate('codex', { home, path: '', appCandidates: {} })).toBeNull()
  })
})

// Older codex builds predate `--dangerously-bypass-hook-trust`; the probe must detect this from
// `--help` so launchFresh can drop context injection instead of crashing the launch. Fake codex
// binaries (tiny shell scripts) stand in for real new/old codex versions.
describe('codexSupportsHookTrust', () => {
  const fakeCodex = (help: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-fakecodex-'))
    const bin = join(dir, 'codex')
    writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${help}\nEOF\n`)
    chmodSync(bin, 0o755)
    return bin
  }
  it('returns true when --help advertises the flag (modern codex)', () => {
    const bin = fakeCodex('Options:\n  --dangerously-bypass-hook-trust\n  --foo')
    expect(codexSupportsHookTrust(bin)).toBe(true)
    expect(codexHookTrustSupportCached(bin)).toBe(true)
  })
  it('returns false when the flag is absent (older codex)', () => {
    const bin = fakeCodex('Options:\n  --dangerously-bypass-approvals-and-sandbox\n  --foo')
    expect(codexSupportsHookTrust(bin)).toBe(false)
    expect(codexHookTrustSupportCached(bin)).toBe(false)
  })
  it('returns false (degrades) when the probe binary cannot run', () => {
    expect(codexSupportsHookTrust(join(tmpdir(), 'no-such-codex-binary'))).toBe(false)
  })
  it('warms the cache asynchronously', async () => {
    const bin = fakeCodex('Options:\n  --dangerously-bypass-hook-trust\n  --foo')
    expect(codexHookTrustSupportCached(bin)).toBeUndefined()
    await expect(warmCodexHookTrustSupport(bin)).resolves.toBe(true)
    expect(codexHookTrustSupportCached(bin)).toBe(true)
  })
})

describe('generic --help capability cache', () => {
  const fakeCli = (help: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-fakecli-'))
    const bin = join(dir, 'agent')
    writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${help}\nEOF\n`)
    chmodSync(bin, 0o755)
    return bin
  }

  it('returns undefined before warm, then a definitive answer per flag after warm', async () => {
    clearAgentBinaryCachesForTest()
    const bin = fakeCli('Usage:\n  --model <m>\n  --add-dir <d>')
    expect(cliFlagSupportedCached(bin, '--model')).toBeUndefined()   // not probed yet (warms in bg)
    await warmCliHelp(bin)
    expect(cliFlagSupportedCached(bin, '--model')).toBe(true)
    expect(cliFlagSupportedCached(bin, '--add-dir')).toBe(true)
    expect(cliFlagSupportedCached(bin, '--append-system-prompt-file')).toBe(false)  // absent
  })

  it('does not cache a probe that cannot run (retries next time)', async () => {
    clearAgentBinaryCachesForTest()
    const missing = join(tmpdir(), 'no-such-agent-binary-xyz')
    await warmCliHelp(missing)
    expect(cliFlagSupportedCached(missing, '--model')).toBeUndefined()  // still unknown, not false
  })
})
