import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { AgentCli } from '../types'

const BLACKLIST = new Set(['/usr/local/bin/trae'])   // Trae CN IDE launcher, NOT the agent

export function resolveAgentBinary(cli: AgentCli): string {
  const candidates: Record<AgentCli, string[]> = {
    claude: [homedir() + '/.local/bin/claude', homedir() + '/.claude/local/claude', '/Applications/cmux.app/Contents/Resources/bin/claude', '/opt/homebrew/bin/claude', 'claude'],
    codex:  [homedir() + '/.local/bin/codex', '/opt/homebrew/bin/codex', 'codex'],
    coco:   [homedir() + '/.local/bin/coco'],
  }
  for (const c of candidates[cli]) {
    if (BLACKLIST.has(c)) continue
    if (c.startsWith('/') ? existsSync(c) : true) {
      if (cli === 'coco') {
        if (!verifyCoco(c)) throw new Error('resolved coco binary failed identity check')
      }
      return c
    }
  }
  throw new Error(`no binary for ${cli}`)
}

// Cache successful identity checks: a binary's identity can't change within a process, and
// `coco --help` does a network/update check that varies 4–15s (cold). Without caching, every
// resume/launch re-pays that cost and an 8s timeout intermittently fails a cold coco. Only
// success is cached, so a transiently-unreachable coco still gets retried on the next launch.
const cocoVerified = new Map<string, boolean>()
export function verifyCoco(bin: string): boolean {
  if (cocoVerified.get(bin)) return true
  let ok = false
  try { ok = /coco, traecli, trae-agent, ta/.test(execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 20000 })) }
  catch { ok = false }
  if (ok) cocoVerified.set(bin, true)
  return ok
}
