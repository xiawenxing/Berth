export const BRACKETED_PASTE_READY = '\x1b[?2004h'
export const LAUNCH_READY_FALLBACK_MS = 30_000

// Per-CLI launch readiness. Each agent's TUI boots differently, so a single heuristic mis-fires —
// this gives every CLI its own dedicated timing (verified against real PTY spools):
//
//  - claude: enables bracketed paste (\x1b[?2004h) exactly when its composer accepts input, so that
//    marker is a reliable ready signal. Quick boot → short quiet thresholds.
//  - codex:  enables bracketed paste at byte 0 (during the banner, long before the composer), so the
//    marker is meaningless here — DON'T trust it. Its boot then shows a `Ns • esc to interrupt`
//    spinner that reprints ~every second, so a sub-second quiet threshold fires BETWEEN ticks and
//    tears the mask down mid-boot. Its quiet thresholds must clear the ~1s tick with margin.
//  - coco / others: no verified paste signal; fall back to the standard quiet thresholds.
export interface CliReadiness {
  /** Trust `\x1b[?2004h` (bracketed-paste enable) as an immediate ready signal. */
  trustBracketedPaste: boolean
  /** Output quiet for this long → fully ready (drop the mask). */
  stableReadyMs: number
  /** Output quiet for this (shorter) long → reveal: un-mask to a click-through veil + ungate input,
   *  so a HITL prompt is visible and answerable before full readiness. */
  revealQuietMs: number
  fallbackMs: number
}

export function cliReadiness(cli: string): CliReadiness {
  switch (cli) {
    case 'claude':
      return { trustBracketedPaste: true, stableReadyMs: 900, revealQuietMs: 400, fallbackMs: LAUNCH_READY_FALLBACK_MS }
    case 'codex':
      // Thresholds sit above codex's ~1s `esc to interrupt` spinner tick so the boot stays masked;
      // they fire on the first genuine post-boot pause (thinking gap / composer idle / HITL wait).
      return { trustBracketedPaste: false, stableReadyMs: 1600, revealQuietMs: 1300, fallbackMs: LAUNCH_READY_FALLBACK_MS }
    default:
      return { trustBracketedPaste: false, stableReadyMs: 900, revealQuietMs: 400, fallbackMs: LAUNCH_READY_FALLBACK_MS }
  }
}

export function shouldMarkLaunchReady({
  cli,
  recentOutput,
  sawData,
  quietMs,
  elapsedMs,
}: {
  cli: string
  recentOutput: string
  sawData: boolean
  quietMs: number
  elapsedMs: number
}): boolean {
  const r = cliReadiness(cli)
  if (r.trustBracketedPaste && sawData && recentOutput.includes(BRACKETED_PASTE_READY)) return true
  if (sawData && quietMs >= r.stableReadyMs) return true
  return elapsedMs >= r.fallbackMs
}

// A quick "the CLI is waiting for the user" signal: output was seen, then went quiet for the CLI's
// reveal window. Drives the reveal step (un-mask + ungate input) so an early HITL surfaces before
// the full ready threshold.
export function shouldRevealLaunch({
  cli,
  sawData,
  quietMs,
}: {
  cli: string
  sawData: boolean
  quietMs: number
}): boolean {
  return sawData && quietMs >= cliReadiness(cli).revealQuietMs
}
