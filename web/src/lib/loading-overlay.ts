// Anti-flash rule for the session terminal's loading overlay. A warm/live session replays its
// scrollback in ~50ms, so showing a spinner immediately would just flash; a cold `--resume` takes
// 2-5s, where a blank terminal reads as broken. So: show the overlay only after a short delay with
// no data yet, and never once the first bytes have arrived.

export const LOADING_OVERLAY_DELAY_MS = 150

// Once the resume overlay IS showing (cold open), don't tear it down on the first replayed byte —
// that first burst is exactly the messy reconnect redraw (scrollback replay + the agent re-answering
// startup queries). Hold the overlay until the stream goes quiet for this long, then reveal a
// settled terminal. Warm resumes never reach this path (data arrives before the show-delay).
export const RESUME_STABLE_READY_MS = 300
// Hard cap so a chatty session that never goes quiet (periodic redraws) can't pin the overlay up.
export const RESUME_OVERLAY_FALLBACK_MS = 6_000

export function shouldShowLoadingOverlay(
  { hasData, elapsedMs, delayMs = LOADING_OVERLAY_DELAY_MS }:
  { hasData: boolean; elapsedMs: number; delayMs?: number },
): boolean {
  if (hasData) return false
  return elapsedMs >= delayMs
}
