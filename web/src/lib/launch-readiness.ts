export const BRACKETED_PASTE_READY = '\x1b[?2004h'
export const LAUNCH_STABLE_READY_MS = 900
export const LAUNCH_READY_FALLBACK_MS = 30_000

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
  if (cli === 'claude' && recentOutput.includes(BRACKETED_PASTE_READY)) return true
  if (sawData && quietMs >= stableMs) return true
  return elapsedMs >= fallbackMs
}
