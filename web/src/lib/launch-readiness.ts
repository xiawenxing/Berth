export const BRACKETED_PASTE_READY = '\x1b[?2004h'
export const LAUNCH_STABLE_READY_MS = 900
export const LAUNCH_READY_FALLBACK_MS = 30_000
// Output quiet for this much shorter window (well before full readiness) means the CLI has paused
// for the user — a HITL prompt (trust-folder, permission, login, model picker) or simply an early
// ready-for-input state. We use it to REVEAL: lift the opaque mask to a translucent veil AND let
// keystrokes through, so the user is never stuck behind the mask unable to answer a prompt. Unlike
// the bracketed-paste signal below, this is CLI-agnostic — it's how non-claude HITL surfaces.
export const LAUNCH_REVEAL_QUIET_MS = 400

export function shouldMarkLaunchReady({
  cli,
  recentOutput,
  sawData,
  quietMs,
  elapsedMs,
  stableMs = LAUNCH_STABLE_READY_MS,
  fallbackMs = LAUNCH_READY_FALLBACK_MS,
}: {
  cli: string
  recentOutput: string
  sawData: boolean
  quietMs: number
  elapsedMs: number
  stableMs?: number
  fallbackMs?: number
}): boolean {
  // Bracketed-paste enable is a reliable "input is live" signal for claude only. NOT generalized to
  // other CLIs: codex turns paste mode on during its startup BANNER (before the composer exists), so
  // trusting it there drops the boot mask while codex is still printing update notices / loading the
  // model. Non-claude CLIs reach readiness via the quiet + fallback signals below (and surface a HITL
  // through the reveal path, which is CLI-agnostic).
  if (cli === 'claude' && sawData && recentOutput.includes(BRACKETED_PASTE_READY)) return true
  if (sawData && quietMs >= stableMs) return true
  return elapsedMs >= fallbackMs
}

// A quick "the CLI is waiting for the user" signal: output was seen, then went quiet briefly. Drives
// the reveal step (un-mask + ungate input) so an early HITL is visible and answerable long before
// the full readiness thresholds above would fire. CLI-agnostic by design.
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
