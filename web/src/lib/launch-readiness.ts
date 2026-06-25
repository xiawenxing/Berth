export const BRACKETED_PASTE_READY = '\x1b[?2004h'
export const LAUNCH_STABLE_READY_MS = 900
export const LAUNCH_READY_FALLBACK_MS = 30_000
// Output quiet for this much shorter window (well before full readiness) means the CLI has paused
// for the user — a HITL prompt (trust-folder, permission, login, model picker) or simply an early
// ready-for-input state. We use it to REVEAL: lift the opaque mask to a translucent veil AND let
// keystrokes through, so the user is never stuck behind the mask unable to answer a prompt.
export const LAUNCH_REVEAL_QUIET_MS = 350

export function shouldMarkLaunchReady({
  recentOutput,
  sawData,
  quietMs,
  elapsedMs,
  stableMs = LAUNCH_STABLE_READY_MS,
  fallbackMs = LAUNCH_READY_FALLBACK_MS,
}: {
  recentOutput: string
  sawData: boolean
  quietMs: number
  elapsedMs: number
  stableMs?: number
  fallbackMs?: number
}): boolean {
  // Bracketed-paste enable means the CLI's input is live. Now honored for ALL CLIs (was claude-only):
  // if a CLI turns paste mode on, it is genuinely accepting input — including at an interactive HITL
  // screen — so the mask should come down. The reveal/live-input path below protects the cases this
  // marker doesn't cover (e.g. a y/n dialog that never enables paste).
  if (sawData && recentOutput.includes(BRACKETED_PASTE_READY)) return true
  if (sawData && quietMs >= stableMs) return true
  return elapsedMs >= fallbackMs
}

// A quick "the CLI is waiting for the user" signal: output was seen, then went quiet briefly. Drives
// the reveal step (un-mask + ungate input) so an early HITL is visible and answerable long before
// the full readiness thresholds above would fire.
export function shouldRevealLaunch({
  sawData,
  quietMs,
  revealMs = LAUNCH_REVEAL_QUIET_MS,
}: {
  sawData: boolean
  quietMs: number
  revealMs?: number
}): boolean {
  return sawData && quietMs >= revealMs
}
