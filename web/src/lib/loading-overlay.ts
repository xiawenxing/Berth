// Anti-flash rule for the session terminal's loading overlay. A warm/live session replays its
// scrollback in ~50ms, so showing a spinner immediately would just flash; a cold `--resume` takes
// 2-5s, where a blank terminal reads as broken. So: show the overlay only after a short delay with
// no data yet, and never once the first bytes have arrived.

export const LOADING_OVERLAY_DELAY_MS = 150

// Resume mask: shown immediately on EVERY resume, so it's consistent across CLIs — the old
// "only show if no data by 150ms" anti-flash gap made it appear for some sessions and skip others
// (a fast-replaying codex resume never tripped it). To avoid a flicker on warm/instant replays it
// stays up for at least RESUME_MIN_VISIBLE_MS; past that it's held until the replayed stream goes
// quiet for RESUME_STABLE_READY_MS (covering the reconnect redraw). RESUME_OVERLAY_FALLBACK_MS is a
// hard cap for a session that never produces replay data or never settles.
export const RESUME_MIN_VISIBLE_MS = 280
export const RESUME_STABLE_READY_MS = 260
export const RESUME_OVERLAY_FALLBACK_MS = 5_000

export function shouldShowLoadingOverlay(
  { hasData, elapsedMs, delayMs = LOADING_OVERLAY_DELAY_MS }:
  { hasData: boolean; elapsedMs: number; delayMs?: number },
): boolean {
  if (hasData) return false
  return elapsedMs >= delayMs
}
