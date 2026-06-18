import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import type { AgentCli } from '../types'

const BLACKLIST = new Set(['/usr/local/bin/trae'])   // Trae CN IDE launcher, NOT the agent
const CANDIDATES: Record<AgentCli, string[]> = {
  claude: [homedir() + '/.local/bin/claude', homedir() + '/.claude/local/claude', '/Applications/cmux.app/Contents/Resources/bin/claude', '/opt/homebrew/bin/claude', 'claude'],
  codex:  [homedir() + '/.local/bin/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', 'codex'],
  coco:   [homedir() + '/.local/bin/coco'],
}

function firstUsableCandidate(cli: AgentCli): string | null {
  for (const c of CANDIDATES[cli]) {
    if (BLACKLIST.has(c)) continue
    if (c.startsWith('/') ? existsSync(c) : true) return c
  }
  return null
}

function execHelp(bin: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--help'], { encoding: 'utf8', timeout }, (err, stdout, stderr) => {
      if (err) { reject(err); return }
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })
}

export function resolveAgentBinary(cli: AgentCli): string {
  const c = firstUsableCandidate(cli)
  if (!c) throw new Error(`no binary for ${cli}`)
  if (cli === 'coco') {
    if (!verifyCoco(c)) throw new Error('resolved coco binary failed identity check')
  }
  return c
}

/** Warm slow CLI probes off the click-to-launch path. Fire-and-forget by design. */
export function warmAgentBinaryCaches(clis: AgentCli[] = ['coco', 'codex']): void {
  for (const cli of clis) {
    const bin = firstUsableCandidate(cli)
    if (!bin) continue
    if (cli === 'coco') void verifyCocoAsync(bin)
    if (cli === 'codex') void warmCodexHookTrustSupport(bin)
  }
}

// Cache successful identity checks: a binary's identity can't change within a process, and
// `coco --help` does a network/update check that varies 4–15s (cold). Without caching, every
// resume/launch re-pays that cost and an 8s timeout intermittently fails a cold coco. Only
// success is cached, so a transiently-unreachable coco still gets retried on the next launch.
const cocoVerified = new Map<string, boolean>()
const cocoVerifyInFlight = new Map<string, Promise<boolean>>()

function cocoHelpLooksRight(help: string): boolean {
  return /coco, traecli, trae-agent, ta/.test(help)
}

export function verifyCocoAsync(bin: string): Promise<boolean> {
  if (cocoVerified.get(bin)) return Promise.resolve(true)
  const existing = cocoVerifyInFlight.get(bin)
  if (existing) return existing
  const p = execHelp(bin, 20000)
    .then(help => {
      const ok = cocoHelpLooksRight(help)
      if (ok) cocoVerified.set(bin, true)
      return ok
    }, () => false)
    .finally(() => {
      if (cocoVerifyInFlight.get(bin) === p) cocoVerifyInFlight.delete(bin)
    })
  cocoVerifyInFlight.set(bin, p)
  return p
}

export function verifyCoco(bin: string): boolean {
  if (cocoVerified.get(bin)) return true
  let ok = false
  try { ok = cocoHelpLooksRight(execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 20000 })) }
  catch { ok = false }
  if (ok) cocoVerified.set(bin, true)
  return ok
}

// Older codex builds predate `--dangerously-bypass-hook-trust` (the SessionStart-hook feature).
// Passing it to such a build aborts the launch with "unexpected argument", so we probe `--help`
// once per binary before relying on the flag. A definitive answer (flag present or absent) is
// cached — a codex binary's CLI surface can't change within a process — but a probe that fails to
// run at all (timeout/spawn error) is NOT cached, so a transient hiccup gets retried next launch.
const codexHookTrust = new Map<string, boolean>()
const codexHookTrustInFlight = new Map<string, Promise<boolean>>()

export function codexHookTrustSupportCached(bin: string): boolean | undefined {
  return codexHookTrust.get(bin)
}

export function warmCodexHookTrustSupport(bin: string): Promise<boolean> {
  const cached = codexHookTrust.get(bin)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = codexHookTrustInFlight.get(bin)
  if (existing) return existing
  const p = execHelp(bin, 20000)
    .then(help => {
      const ok = help.includes('--dangerously-bypass-hook-trust')
      codexHookTrust.set(bin, ok)
      return ok
    }, () => false)
    .finally(() => {
      if (codexHookTrustInFlight.get(bin) === p) codexHookTrustInFlight.delete(bin)
    })
  codexHookTrustInFlight.set(bin, p)
  return p
}

export function codexHookTrustSupportOrWarm(bin: string): boolean | undefined {
  const cached = codexHookTrust.get(bin)
  if (cached !== undefined) return cached
  void warmCodexHookTrustSupport(bin)
  return undefined
}

export function codexSupportsHookTrust(bin: string): boolean {
  const cached = codexHookTrust.get(bin)
  if (cached !== undefined) return cached
  let help: string
  try { help = execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 20000 }) }
  catch { return false }   // probe couldn't run; degrade to no-hook for this launch, retry later
  const ok = help.includes('--dangerously-bypass-hook-trust')
  codexHookTrust.set(bin, ok)
  return ok
}

export function clearAgentBinaryCachesForTest(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('clearAgentBinaryCachesForTest is test-only')
  }
  cocoVerified.clear()
  cocoVerifyInFlight.clear()
  codexHookTrust.clear()
  codexHookTrustInFlight.clear()
}
