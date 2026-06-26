import type { AgentCli } from '../types'
import { KNOWN_CLIS, MIN_CLI_VERSIONS, type CliStatus } from '../data/agent-config'
import { firstUsableCandidate, verifyCocoAsync, execVersion } from './binaries'

/** Pull the first `x.y.z` out of a `--version` blob (banners/suffixes vary by CLI). */
export function extractSemver(text: string): string | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
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
