// Model-A (TUI) first-turn submission, gated on the CLI being genuinely IDLE — not on the raw
// bracketed-paste marker.
//
// Why: claude enables bracketed paste (\x1b[?2004h) ~2-3s into boot, while its "welcome / What's new"
// screen is still rendering. At that moment the composer accepts *typed* input (a paste lands) but a
// submit (Enter) is dropped — the turn never runs and the query sits in the box. (Verified live: paste
// at the first 2004h inserts text but the Enter is lost; the composer only truly settles a few seconds
// later.) So the reliable "ready to submit a turn" signal is OUTPUT GOING QUIET after the marker — the
// CLI has finished booting/rendering and is idle, which is exactly when the old 8s Enter-nudge worked.
//
// We then mirror what a human does, each step gated on quiet so we never race the CLI's rendering:
//   text:   [ready] paste prompt → [rendered] Enter
//   image:  [ready] paste image  → [attached] paste prompt → [rendered] Enter
//   image-only (no prompt): [ready] paste image → [attached] Enter

export const BRACKETED_PASTE_READY = '\x1b[?2004h'
const IMAGE_ATTACH_MARK = '[Image'

// Composer is idle after the boot render goes quiet this long (past the marker).
export const READY_QUIET_MS = 1_000
// A paste / image chip has rendered and the CLI went quiet again.
export const RENDER_QUIET_MS = 450
// Backstops so a CLI that never goes cleanly quiet still submits rather than stranding the turn.
export const READY_FALLBACK_MS = 12_000
export const ATTACH_FALLBACK_MS = 6_000
export const RENDER_FALLBACK_MS = 3_000

export type SubmitEmit =
  | 'images'
  | 'paste'
  | 'enter'
  | { kind: 'image'; index: number }
  | { kind: 'pasteText'; text: string }

export interface SubmitSignals {
  /** All output accumulated since the launch handshake. */
  recentOutput: string
  /** Output produced since the current step became active (to detect the step's own ack). */
  newOutputSinceStep: string
  /** Milliseconds since the last output frame (0 = output arriving now). */
  quietMs: number
  /** Milliseconds since the current step became active. */
  elapsedSinceStepMs: number
}

export interface SubmitStep {
  emit: SubmitEmit
  /** True when it's safe to perform this step's emit given the current signals. */
  ready: (s: SubmitSignals) => boolean
}

// The composer exists (bracketed paste enabled) AND the boot render has gone quiet → safe to start.
export const readyGuard = (s: SubmitSignals): boolean =>
  (s.recentOutput.includes(BRACKETED_PASTE_READY) && s.quietMs >= READY_QUIET_MS) ||
  s.elapsedSinceStepMs >= READY_FALLBACK_MS

// The image we just pasted has been turned into an attachment chip ([Image …]) and rendering settled.
export const attachGuard = (s: SubmitSignals): boolean =>
  (s.newOutputSinceStep.includes(IMAGE_ATTACH_MARK) && s.quietMs >= RENDER_QUIET_MS) ||
  s.elapsedSinceStepMs >= ATTACH_FALLBACK_MS

// The text we just pasted has rendered into the composer and rendering settled.
export const renderGuard = (s: SubmitSignals): boolean =>
  s.quietMs >= RENDER_QUIET_MS || s.elapsedSinceStepMs >= RENDER_FALLBACK_MS

/** Build the gated emit sequence for a Model-A first turn. Empty when there is nothing to submit
 *  over the socket (caller handles those cases — URL positional / Model B / no prompt). */
export function firstTurnSteps(opts: { hasImages: boolean; hasPrompt: boolean }): SubmitStep[] {
  const { hasImages, hasPrompt } = opts
  if (hasImages && hasPrompt) {
    return [
      { emit: 'images', ready: readyGuard },
      { emit: 'paste', ready: attachGuard },
      { emit: 'enter', ready: renderGuard },
    ]
  }
  if (hasImages && !hasPrompt) {
    return [
      { emit: 'images', ready: readyGuard },
      { emit: 'enter', ready: attachGuard },
    ]
  }
  if (!hasImages && hasPrompt) {
    return [
      { emit: 'paste', ready: readyGuard },
      { emit: 'enter', ready: renderGuard },
    ]
  }
  return []
}
