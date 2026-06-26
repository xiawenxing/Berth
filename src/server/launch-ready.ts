import { latestCodexTurnState } from '../adapters/codex-turn'
import type { HoldRunning } from './activity'

// Per-CLI launch readiness on the SERVER side. The frontend's time-based heuristic mis-fires because
// a CLI's boot has pauses (a mid-boot confirmation, MCP startup) that a quiet-timer can't tell apart
// from "done". Where a CLI exposes a deterministic signal we use it instead.

// ── coco: no deterministic signal ────────────────────────────────────────────────────────────────
// coco enables bracketed-paste during its banner (useless as a marker) and has NO turn-state file.
// Its activity FSM would otherwise settle (停泊) on the first >IDLE_MS gap DURING boot — a false
// "已停泊". This guard holds the session `running` for a short grace window after launch so a boot
// pause can't settle it; once real turn output flows, normal output-sustain takes over and the grace
// is irrelevant. Worst case (a turn that finishes inside the grace) over-holds `running` briefly.
export const COCO_BOOT_HOLD_MS = 8_000
export function bootGraceHold(graceMs: number, now: () => number = () => Date.now()): HoldRunning {
  const start = now()
  return () => now() - start < graceMs
}

// ── codex: deterministic via its rollout ─────────────────────────────────────────────────────────
// codex writes `task_started` (and later `task_complete`) to its rollout JSONL when the FIRST turn
// actually begins — after boot AND any confirmation. Either lifecycle event means boot is over, so
// `!== 'unknown'` is the precise "drop the launch mask now" signal.
export function codexTurnStarted(path: string | null): boolean {
  return !!path && latestCodexTurnState(path) !== 'unknown'
}

export const CODEX_TURN_WATCH_INTERVAL_MS = 500
export const CODEX_TURN_WATCH_TIMEOUT_MS = 40_000

/**
 * Poll for a fresh codex launch's first turn and fire `emit(realSessionId)` once it deterministically
 * begins. Until the intent is reconciled to its real session id we `refresh()` to drive reconcile;
 * after that we just tail the rollout (cheap). Stops on emit, timeout, or the session dying. Returns a
 * stop fn. Deps are injected so the polling logic stays decoupled from the store/registry singletons.
 */
export function watchCodexFirstTurn(deps: {
  refresh: () => void
  boundSessionId: () => string | null
  pathFor: (sessionId: string) => string | null
  alive: (sessionId: string) => boolean
  emit: (sessionId: string) => void
  now?: () => number
}): () => void {
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  let path: string | null = null
  const stop = () => clearInterval(interval)
  const interval = setInterval(() => {
    try {
      if (now() - startedAt > CODEX_TURN_WATCH_TIMEOUT_MS) { stop(); return }
      let sid = deps.boundSessionId()
      if (!sid) { deps.refresh(); sid = deps.boundSessionId() }   // drive reconcile until bound
      if (!sid) return
      if (!deps.alive(sid)) { stop(); return }                   // died before a turn → give up
      if (!path) path = deps.pathFor(sid)
      if (codexTurnStarted(path)) { deps.emit(sid); stop() }
    } catch { /* transient (mid-rekey / file not ready) — keep polling until timeout */ }
  }, CODEX_TURN_WATCH_INTERVAL_MS)
  ;(interval as { unref?: () => void }).unref?.()
  return stop
}
