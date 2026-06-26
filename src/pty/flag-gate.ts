import { cliFlagSupportedCached } from './binaries'
import type { AgentCli } from '../types'

/**
 * Graceful degradation for version-sensitive CLI flags. Different installed versions of
 * claude/codex/coco support different flags; passing one the binary doesn't understand makes it abort
 * the launch ("unexpected argument"). So before spawning, we DROP any "degradable" flag the binary's
 * `--help` confirms it lacks — the launch still runs, just without that enhancement.
 *
 * Two rules keep this safe:
 *  1. Only DEGRADABLE flags are gated (listed below) — enhancements whose absence still leaves a
 *     working session (model pick, extra dirs, context injection, cosmetic TUI flags). LOAD-BEARING
 *     flags (`-p`, `--output-format stream-json`, `--session-id`, `--resume`, the bypass-permission
 *     flags) are NEVER gated: if a build truly lacks them it's the wrong version for that mode, and
 *     silently dropping them would make a broken session look fine. Those surface via the instant-exit
 *     diagnostic instead.
 *  2. A flag is dropped ONLY on a CONFIRMED-absent probe (`supported === false`). Unknown (probe not
 *     warmed yet) KEEPS the flag, so a working setup is never degraded by a cold cache — warming at
 *     boot makes "confirmed" the normal case.
 */
interface DegradableFlag {
  flag: string
  takesValue: boolean   // `--model gpt` removes two tokens; `--no-alt-screen` removes one
}

const DEGRADABLE: Record<AgentCli, DegradableFlag[]> = {
  claude: [
    { flag: '--append-system-prompt-file', takesValue: true },
    { flag: '--add-dir', takesValue: true },
    { flag: '--model', takesValue: true },
    { flag: '--include-partial-messages', takesValue: false },
  ],
  codex: [
    { flag: '--no-alt-screen', takesValue: false },
    { flag: '--model', takesValue: true },
    { flag: '--add-dir', takesValue: true },
  ],
  coco: [
    { flag: '--add-dir', takesValue: true },
    { flag: '--include-partial-messages', takesValue: false },
  ],
}

export type FlagSupport = (flag: string) => boolean | undefined

/**
 * Pure core: return `argv` with every degradable flag the support-probe reports as UNSUPPORTED
 * (`=== false`) removed, along with its value token when it takes one. Repeated flags (e.g. multiple
 * `--add-dir`) are all handled. Anything not in the cli's degradable list is passed through untouched.
 * Returns the (possibly same) array plus the list of dropped flags for diagnostics.
 */
export function gateArgv(cli: AgentCli, argv: string[], isSupported: FlagSupport): { argv: string[]; dropped: string[] } {
  const degradable = new Map(DEGRADABLE[cli].map((d) => [d.flag, d]))
  // Resolve each degradable flag once (the probe is per-flag, not per-occurrence).
  const drop = new Set<string>()
  for (const d of DEGRADABLE[cli]) {
    if (isSupported(d.flag) === false) drop.add(d.flag)
  }
  if (drop.size === 0) return { argv, dropped: [] }

  const out: string[] = []
  const dropped: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (drop.has(tok)) {
      dropped.push(tok)
      if (degradable.get(tok)!.takesValue) i++   // also skip the value token
      continue
    }
    out.push(tok)
  }
  return { argv: out, dropped }
}

/** Wire `gateArgv` to the real per-binary `--help` cache. Used right before every CLI spawn. */
export function gateArgvForBinary(cli: AgentCli, bin: string, argv: string[]): { argv: string[]; dropped: string[] } {
  return gateArgv(cli, argv, (flag) => cliFlagSupportedCached(bin, flag))
}

/**
 * Force-drop EVERY degradable flag, regardless of probe state. The most-compatible arg set, used as
 * the reactive last resort: if a launch fast-fails despite proactive gating (e.g. the probe was cold
 * or wrong), the retry strips all enhancements to maximize the chance the bare session starts.
 */
export function stripAllDegradable(cli: AgentCli, argv: string[]): { argv: string[]; dropped: string[] } {
  return gateArgv(cli, argv, () => false)
}
