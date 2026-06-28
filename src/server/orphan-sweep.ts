
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
