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
  /** Whether output-quiet may mark the launch READY (drop the mask). False for CLIs that get a
   *  deterministic server signal instead (codex), since their boot has long silent pauses
   *  (`model: loading`) that a quiet-timer can't distinguish from "ready". */
  quietMarksReady: boolean
  /** Output quiet for this long → fully ready (drop the mask). Only used when quietMarksReady. */
  stableReadyMs: number
  /** Output quiet for this (shorter) long → reveal: un-mask to a click-through veil + ungate input,
   *  so a HITL prompt is visible and answerable before full readiness. */
  revealQuietMs: number
  fallbackMs: number
}

export function cliReadiness(cli: string): CliReadiness {
  switch (cli) {
    case 'claude':
      return { trustBracketedPaste: true, quietMarksReady: true, stableReadyMs: 900, revealQuietMs: 400, fallbackMs: LAUNCH_READY_FALLBACK_MS }
    case 'codex':
      // codex gets a DETERMINISTIC server `turnStarted` frame (rollout task_started) — that, not
      // output-quiet, drops the mask. quietMarksReady:false because codex's boot has multi-second
      // silent pauses (`model: loading`) that a quiet-timer wrongly reads as "ready", flashing the
      // raw boot. Quiet still drives the reveal veil (so a pre-turn HITL surfaces), on a long window
      // that normal model-loading pauses usually clear without tripping. 30s fallback as a backstop.
      return { trustBracketedPaste: false, quietMarksReady: false, stableReadyMs: 1600, revealQuietMs: 2500, fallbackMs: LAUNCH_READY_FALLBACK_MS }
    case 'coco':
      // coco boots like codex (banner + MCP startup, bracketed-paste at byte 0) but has NO rollout /
      // deterministic signal — so it must keep quiet→ready, on codex-like longer quiet windows.
      return { trustBracketedPaste: false, quietMarksReady: true, stableReadyMs: 1600, revealQuietMs: 1300, fallbackMs: LAUNCH_READY_FALLBACK_MS }
    default:
      return { trustBracketedPaste: false, quietMarksReady: true, stableReadyMs: 900, revealQuietMs: 400, fallbackMs: LAUNCH_READY_FALLBACK_MS }
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
  if (r.quietMarksReady && sawData && quietMs >= r.stableReadyMs) return true
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
