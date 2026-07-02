
export interface BoundLaunchLite { id: string; sessionId: string | null; createdAt: number }

/**
 * Ids of bound launches that are dangling: a session id was eagerly edged at launch (claude/coco) but
 * the session never materialized — its pty is dead, no jsonl exists for it, and it is older than the
 * boot grace period (so we don't sweep a slow-but-real launch mid-boot). Pure; the caller drops the
 * intent + its edge.
 */
export function selectOrphanLaunches(
  bound: BoundLaunchLite[],
  opts: { nowSec: number; graceSec: number; hasLivePty: (sessionId: string) => boolean; sessionExists: (sessionId: string) => boolean },
): string[] {
  return bound
    .filter(b => b.sessionId !== null)
    .filter(b => opts.nowSec - b.createdAt > opts.graceSec)
    .filter(b => !opts.hasLivePty(b.sessionId!))
    .filter(b => !opts.sessionExists(b.sessionId!))
    .map(b => b.id)
}

export interface PendingIntentLite { id: string; cli: string; sessionId: string | null; createdAt: number }

/**
 * Ids of never-bound codex intents to drop: a codex launch that never produced its rollout
 * `session_meta` (binary missing / crash / trust-abort) leaves a permanently-pending intent, which
 * keeps Channel B's rollout poll armed forever. Sweep it once it is older than a generous TTL AND its
 * pty is gone (an unbound codex pty is keyed by the intent id). A still-live pty is left alone — codex
 * may yet write session_meta. Pure; the caller deletes the intent (there is no edge — it never bound).
 */
export function selectExpiredUnboundIntents(
  pending: PendingIntentLite[],
  opts: { nowSec: number; ttlSec: number; hasLivePty: (key: string) => boolean },
): string[] {
  return pending
    .filter(i => i.cli === 'codex')
    .filter(i => i.sessionId === null)
    .filter(i => opts.nowSec - i.createdAt > opts.ttlSec)
    .filter(i => !opts.hasLivePty(i.id))
    .map(i => i.id)
}
