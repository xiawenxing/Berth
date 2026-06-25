// Anti-flash rule for the session terminal's loading overlay. A warm/live session replays its
// scrollback in ~50ms, so showing a spinner immediately would just flash; a cold `--resume` takes
// 2-5s, where a blank terminal reads as broken. So: show the overlay only after a short delay with
// no data yet, and never once the first bytes have arrived.

export const LOADING_OVERLAY_DELAY_MS = 150

export function shouldShowLoadingOverlay(
  { hasData, elapsedMs, delayMs = LOADING_OVERLAY_DELAY_MS }:
  { hasData: boolean; elapsedMs: number; delayMs?: number },
): boolean {
  if (hasData) return false
  return elapsedMs >= delayMs
}
