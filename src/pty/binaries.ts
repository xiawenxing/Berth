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

export function firstUsableCandidate(cli: AgentCli): string | null {
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

export function execVersion(bin: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], { encoding: 'utf8', timeout }, (err, stdout, stderr) => {
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
export function warmAgentBinaryCaches(clis: AgentCli[] = ['claude', 'coco', 'codex']): void {
  for (const cli of clis) {
    const bin = firstUsableCandidate(cli)
    if (!bin) continue
    if (cli === 'coco') void verifyCocoAsync(bin)
    // Warm the `--help` text for EVERY cli so flag-gating (src/pty/flag-gate.ts) has a definitive
    // answer by the time a human clicks launch — without it, the first launch can't tell whether a
    // version-sensitive flag is supported and keeps it (optimistic), so warming closes that window.
    void warmCliHelp(bin)
  }
}

// ── Generic per-binary `--help` capability cache ─────────────────────────────────────────────────
// One `--help` probe per binary serves every flag-support question for that CLI (a binary's CLI
// surface can't change within a process). Only a SUCCESSFUL probe is cached; a probe that can't run
// (timeout/spawn error) is left uncached so a transient hiccup is retried on the next launch.
const cliHelp = new Map<string, string>()
const cliHelpInFlight = new Map<string, Promise<string | null>>()

export function warmCliHelp(bin: string): Promise<string | null> {
  const cached = cliHelp.get(bin)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = cliHelpInFlight.get(bin)
  if (existing) return existing
  const p = execHelp(bin, 20000)
    .then((help) => { cliHelp.set(bin, help); return help }, () => null)
    .finally(() => { if (cliHelpInFlight.get(bin) === p) cliHelpInFlight.delete(bin) })
  cliHelpInFlight.set(bin, p)
  return p
}

/**
 * Is `flag` supported by the CLI at `bin`? Returns:
 *   - true/false when `--help` has been probed (definitive),
 *   - undefined when not yet probed (kicks off a background warm).
 * Callers gate version-sensitive flags on `=== false` (drop it) and keep the flag on true/undefined,
 * so a working setup is never degraded by a cold cache — only a CONFIRMED-missing flag is dropped.
 */
export function cliFlagSupportedCached(bin: string, flag: string): boolean | undefined {
  const help = cliHelp.get(bin)
  if (help === undefined) { void warmCliHelp(bin); return undefined }
  return help.includes(flag)
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
// Passing it to such a build aborts the launch with "unexpected argument", so launchFresh gates the
// flag on this probe. Thin wrappers over the shared `--help` cache above (one probe per binary), kept
// as a named API because the codex-hook gate is conservative (drops context injection on UNKNOWN too,
// since an unknown flag would abort the whole launch) — distinct from the generic keep-on-unknown.
const HOOK_TRUST_FLAG = '--dangerously-bypass-hook-trust'

export function codexHookTrustSupportCached(bin: string): boolean | undefined {
  return cliFlagSupportedCached(bin, HOOK_TRUST_FLAG)
}

export function warmCodexHookTrustSupport(bin: string): Promise<boolean> {
  return warmCliHelp(bin).then((help) => help != null && help.includes(HOOK_TRUST_FLAG))
}

export function codexHookTrustSupportOrWarm(bin: string): boolean | undefined {
  return codexHookTrustSupportCached(bin)   // cliFlagSupportedCached already warms on a miss
}

export function codexSupportsHookTrust(bin: string): boolean {
  const cached = codexHookTrustSupportCached(bin)
  if (cached !== undefined) return cached
  let help: string
  try { help = execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 20000 }) }
  catch { return false }   // probe couldn't run; degrade to no-hook for this launch, retry later
  cliHelp.set(bin, help)   // populate the shared cache so later flag checks reuse this probe
  return help.includes(HOOK_TRUST_FLAG)
}

export function clearAgentBinaryCachesForTest(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('clearAgentBinaryCachesForTest is test-only')
  }
  cocoVerified.clear()
  cocoVerifyInFlight.clear()
  cliHelp.clear()
  cliHelpInFlight.clear()
}
