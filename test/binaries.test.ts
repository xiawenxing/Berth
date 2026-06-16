import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentBinary, codexSupportsHookTrust } from '../src/pty/binaries'
import { resumeArgv } from '../src/pty/launch'
describe('binaries + argv', () => {
  it('pins coco to ~/.local/bin and never returns the trae IDE launcher', { timeout: 25000 }, () => {
    expect(resolveAgentBinary('coco')).toMatch(/\/\.local\/bin\/coco$/)
    expect(resolveAgentBinary('coco')).not.toBe('/usr/local/bin/trae')
  })
  it('maps each cli to a resume argv template', () => {
    expect(resumeArgv('claude', 'U')).toEqual(['--resume', 'U'])
    expect(resumeArgv('codex', 'U')).toEqual(['resume', 'U'])
    expect(resumeArgv('coco', 'U')).toEqual(['--resume=U'])   // pflag optional-value: must use =id, see launch.test.ts
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
    expect(codexSupportsHookTrust(fakeCodex('Options:\n  --dangerously-bypass-hook-trust\n  --foo'))).toBe(true)
  })
  it('returns false when the flag is absent (older codex)', () => {
    expect(codexSupportsHookTrust(fakeCodex('Options:\n  --dangerously-bypass-approvals-and-sandbox\n  --foo'))).toBe(false)
  })
  it('returns false (degrades) when the probe binary cannot run', () => {
    expect(codexSupportsHookTrust(join(tmpdir(), 'no-such-codex-binary'))).toBe(false)
  })
})
