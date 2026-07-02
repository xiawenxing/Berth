import { canonicalPathKey } from '../path-normalize'

export interface RolloutMeta { sessionId: string; cwd: string; startedAtSec: number }
export interface PendingIntentLite { id: string; cwd: string; createdAt: number }

/** Parse a codex rollout's first line — the `session_meta` record — into {sessionId, cwd, startedAt}.
 *  Null for any other line shape. `payload.timestamp` is the session's own start time (ISO). */
export function parseSessionMeta(firstLine: string): RolloutMeta | null {
  let obj: any
  try { obj = JSON.parse(firstLine) } catch { return null }
  if (!obj || obj.type !== 'session_meta' || !obj.payload) return null
  const p = obj.payload
  if (typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null
  const ts = Date.parse(p.timestamp ?? obj.timestamp ?? '')
  if (Number.isNaN(ts)) return null
  return { sessionId: p.session_id, cwd: p.cwd, startedAtSec: Math.floor(ts / 1000) }
}

/**
 * Find the pending codex intent a new rollout belongs to: same cwd (path-normalized) AND the rollout
 * start time within [intent.createdAt, intent.createdAt + windowSec]. When several windows overlap,
 * the EARLIEST-createdAt intent wins (it launched first, so its session surfaced first). Returns the
 * intent id, or null. Channel A's launchToken corrects any genuine ambiguity; this is the guaranteed
 * fallback, so it errs toward matching.
 */
export function matchRolloutToIntent(
  intents: PendingIntentLite[],
  rollout: { cwd: string; startedAtSec: number },
  windowSec = 90,
): string | null {
  const rc = canonicalPathKey(rollout.cwd)
  // Take only the EARLIEST-createdAt intent for this cwd: intents are consumed once matched,
  // so the pending queue is FIFO — the first launched codex produces the first rollout. If
  // the rollout arrived after that intent's window has closed, don't fall through to later
  // intents (their rollouts haven't appeared yet).
  const earliest = intents
    .filter(i => canonicalPathKey(i.cwd) === rc)
    .sort((a, b) => a.createdAt - b.createdAt)[0]
  if (!earliest) return null
  if (rollout.startedAtSec < earliest.createdAt || rollout.startedAtSec > earliest.createdAt + windowSec) return null
  return earliest.id
}
