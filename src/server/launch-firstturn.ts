// Model-A first-turn safety net.
//
// A TUI launch delivers its first turn as the CLI's NATIVE positional [PROMPT], which the CLI is
// supposed to auto-submit once its composer is ready. claude's interactive auto-submit has a rare
// slow-cold-start miss (gotcha #15, ~1/4): the prompt pre-fills but never gets the Enter, so no turn
// runs → no jsonl → the session never surfaces. When the drawer is open the user just sees it and
// presses Enter; when they closed the drawer mid-startup it wedges. This nudges a single Enter once
// the composer is surely ready (a generous delay) IF the launch still hasn't taken a turn — submitting
// the already-pre-filled prompt. Strictly Model-A; Model-B delivers over stdin and never needs it.
//
// Double-submit is guarded against: we skip the nudge the moment the session has surfaced (a turn
// already happened → jsonl exists). codex is excluded — it has a deterministic turn-start watcher and
// a reliable positional submit (probe: ~150ms, no miss).

import type { AgentCli } from '../types'

export const FIRST_TURN_NUDGE_DELAYS_MS = [8000, 16000]

/** Whether to arm the Enter nudge for this launch. Pure. */
export function shouldArmFirstTurnNudge(p: { cli: AgentCli; mode: 'tui' | 'stream'; hasInitialPrompt: boolean }): boolean {
  if (p.mode !== 'tui' || !p.hasInitialPrompt) return false
  return p.cli === 'claude' || p.cli === 'coco'
}

export interface FirstTurnNudgeDeps {
  /** PTY still live? (a launch that already exited needs no nudge) */
  alive: () => boolean
  /** Has the session written a jsonl / taken a turn? (true → skip, never double-submit) */
  surfaced: () => boolean
  /** Submit the pre-filled positional prompt (write '\r' to the pty). */
  sendEnter: () => void
  /** Report each attempt's outcome (for diagnostics). */
  onAttempt?: (fired: boolean, attempt: number) => void
  delaysMs?: number[]
  /** Injectable scheduler (real setTimeout in prod; synchronous capture in tests). */
  schedule?: (fn: () => void, ms: number) => void
}

/** Arm one or more delayed Enter nudges. Each attempt independently re-checks alive && !surfaced, so a
 *  turn that lands between attempts cancels the rest. Pure control flow; all IO is injected. */
export function armFirstTurnNudge(deps: FirstTurnNudgeDeps): void {
  const delays = deps.delaysMs ?? FIRST_TURN_NUDGE_DELAYS_MS
  const schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.() })
  delays.forEach((ms, i) => {
    schedule(() => {
      if (!deps.alive() || deps.surfaced()) { deps.onAttempt?.(false, i); return }
      deps.sendEnter()
      deps.onAttempt?.(true, i)
    }, ms)
  })
}
