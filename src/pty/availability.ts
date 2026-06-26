import type { AgentCli } from '../types'
import { KNOWN_CLIS, MIN_CLI_VERSIONS, type CliStatus } from '../data/agent-config'
import { firstUsableCandidate, verifyCocoAsync, execVersion } from './binaries'

/** Pull the first `x.y.z` out of a `--version` blob (banners/suffixes vary by CLI). */
export function extractSemver(text: string): string | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? m[0] : null
}

/** `a >= b` for dotted `x.y.z` strings. */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

const VERSION_TIMEOUT_MS = 20_000   // matches the existing --help probe timeout

/** Build the "binary not found" status for a CLI. */
function missingStatus(cli: AgentCli): CliStatus {
  return {
    cli, installed: false, binPath: null, version: null,
    minVersion: MIN_CLI_VERSIONS[cli] ?? null, ok: false, reason: 'missing',
  }
}

/** Force-fresh detect ONE CLI. Best-effort: probe failures degrade to `unverified`, never throw. */
export async function detectCli(cli: AgentCli): Promise<CliStatus> {
  const bin = firstUsableCandidate(cli)
  let status: CliStatus
  if (!bin) {
    status = missingStatus(cli)
  } else if (cli === 'coco') {
    // coco has no version floor — identity check is its gate (reuses the cached probe).
    const ok = await verifyCocoAsync(bin)
    status = { cli, installed: true, binPath: bin, version: null, minVersion: null, ok, reason: ok ? 'ok' : 'unverified' }
  } else {
    const min = MIN_CLI_VERSIONS[cli] ?? null
    let out: string | null = null
    try { out = await execVersion(bin, VERSION_TIMEOUT_MS) } catch { out = null }
    const version = out ? extractSemver(out) : null
    if (!version) {
      status = { cli, installed: true, binPath: bin, version: null, minVersion: min, ok: false, reason: 'unverified' }
    } else {
      const ok = min ? semverGte(version, min) : true
      status = { cli, installed: true, binPath: bin, version, minVersion: min, ok, reason: ok ? 'ok' : 'outdated' }
    }
  }
  cache.set(cli, status)
  return status
}

// In-process cache: last detection per CLI. Startup populates it; the Settings on-enable path and
// POST /settings refresh it. A CLI never probed yet reads back as `missing` (conservative).
const cache = new Map<AgentCli, CliStatus>()

/** All CLIs from cache, filling un-probed ones with their `missing` default. */
export function getCachedAvailability(): CliStatus[] {
  return KNOWN_CLIS.map(cli => cache.get(cli) ?? missingStatus(cli))
}

/** The set of currently-`ok` CLIs (from cache). Used to gate seeding + enable validation. */
export function okCliSet(): Set<AgentCli> {
  return new Set(getCachedAvailability().filter(s => s.ok).map(s => s.cli))
}

/** Force-fresh detect ALL known CLIs in parallel; updates the cache. */
export async function detectAllClis(): Promise<CliStatus[]> {
  return Promise.all(KNOWN_CLIS.map(detectCli))
}
