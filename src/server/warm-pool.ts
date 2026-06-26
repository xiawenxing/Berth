// Server-side bounded warm pool: at boot, pre-spawn the top-K resumable sessions so their first
// open hits the pty-registry fast path instead of paying a cold `--resume` spawn (the multi-second
// blank). See docs/superpowers/specs/2026-06-23-session-warm-pool-and-loading-skeleton-design.md.
//
// This file keeps its core decisions PURE (selectWarmSessions / createWarmPool / resolveWarmPoolSize)
// so they are unit-tested without touching node-pty or the registry; the orchestration below is the
// impure glue verified by live/manual runs.
import { getCache, getStore } from './store-singleton'
import { snapshotActivity, hasLivePty, killPty } from './pty-registry'
import { firstUsableCandidate } from '../pty/binaries'
import { verifyCocoAsync } from '../pty/binaries'
import { spawnAndRegister } from './resume-spawn'

const DEFAULT_WARM_POOL = 6
const WARM_GEOM = { cols: 120, rows: 30 }   // no client yet; the real viewer resizes on attach
const MAX_CONCURRENT_WARM = 2               // throttle: never a boot-time spawn storm

/** A session as the picker sees it — joined from the cache (resumable/deleted/updatedAt) and the
 *  serialized view (pinned/running) and the registry (live). */
export interface WarmCandidate {
  sessionId: string
  pinned: boolean
  running: boolean
  updatedAt: number
  resumable: boolean
  deleted: boolean
  live: boolean
}

/**
 * Pick which sessions to warm, in priority order. Unread is client-only (localStorage), invisible
 * server-side, so the ranking the server CAN see is pinned → running → recent. Skips sessions that
 * are deleted, not resumable, or already live (warming them is pointless).
 */
export function selectWarmSessions(cands: WarmCandidate[], k: number): string[] {
  if (k <= 0) return []
  return cands
    .filter(c => !c.deleted && c.resumable && !c.live)
    .sort((a, b) =>
      (Number(b.pinned) - Number(a.pinned)) ||
      (Number(b.running) - Number(a.running)) ||
      (b.updatedAt - a.updatedAt))
    .slice(0, k)
    .map(c => c.sessionId)
}

/**
 * Bounded bookkeeping for warm-but-not-yet-opened sessions. Only entries still in the pool are
 * eligible for eviction — a session the user actually opens is graduated out (markOpened) and is
 * never killed by the pool. Eviction is oldest-first (insertion order). kill() performs the real
 * pty teardown; the pool only tracks ids.
 */
export function createWarmPool(opts: { cap: number; kill: (sessionId: string) => void }) {
  const order: string[] = []   // oldest first; only warm-not-opened ids
  const drop = (id: string) => {
    const i = order.indexOf(id)
    if (i >= 0) order.splice(i, 1)
  }
  return {
    add(sessionId: string): void {
      drop(sessionId)            // de-dup: re-warming moves it to the newest slot
      order.push(sessionId)
      while (order.length > opts.cap) opts.kill(order.shift()!)
    },
    markOpened(sessionId: string): void { drop(sessionId) },   // graduate — no longer counted/evictable
    noteExited(sessionId: string): void { drop(sessionId) },   // pty ended on its own
    size(): number { return order.length },
    has(sessionId: string): boolean { return order.includes(sessionId) },
  }
}

/** Resolve the configured pool size: env BERTH_WARM_POOL wins, else the stored setting, else 6.
 *  Only non-negative integers are accepted; 0 disables warming. */
export function resolveWarmPoolSize(
  env: string | undefined,
  stored: string | null,
  fallback: number = DEFAULT_WARM_POOL,
): number {
  for (const raw of [env, stored]) {
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return n
  }
  return fallback
}

// ── Orchestration (impure glue) ──────────────────────────────────────────────

export function warmPoolSize(): number {
  return resolveWarmPoolSize(process.env.BERTH_WARM_POOL, getStore().getSetting('warmPoolSize'))
}

// Module singleton: the live pool, created on first warm. markOpened() is a no-op until then.
let pool: ReturnType<typeof createWarmPool> | null = null

/** Graduate a session the user opened so the warm pool stops counting/evicting it. Safe to call for
 *  any session id (no-op if not warmed). Wired from the /pty resume fast path. */
export function markOpened(sessionId: string): void { pool?.markOpened(sessionId) }

/** Build warm candidates by joining the cache (resumable/deleted/updatedAt) with the serialized
 *  pinned/running view and the registry's live set. */
function warmCandidates(): WarmCandidate[] {
  const pinned = getStore().allPinnedSet()
  const running = new Set(snapshotActivity().filter(a => a.state === 'running').map(a => a.sessionId))
  return getCache().map(s => ({
    sessionId: s.sessionId,
    pinned: pinned.has(s.sessionId),
    running: running.has(s.sessionId),
    updatedAt: s.updatedAt,
    resumable: !!s.resume,
    deleted: !!s.deleted,
    live: hasLivePty(s.sessionId),
  }))
}

/**
 * Boot warm-up: pre-spawn the top-K resumable sessions so their first open hits the fast path.
 * Fire-and-forget — must never block the listen or the event loop. coco's slow `--help` identity
 * probe is awaited (async, off the click path) before its spawn so resumeSession's sync verify is a
 * cache hit.
 */
export async function warmSessionPool(): Promise<void> {
  const k = warmPoolSize()
  if (k <= 0) return
  pool = createWarmPool({ cap: k, kill: killPty })
  const ids = selectWarmSessions(warmCandidates(), k)
  const byId = new Map(getCache().map(s => [s.sessionId, s]))

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      const s = byId.get(id)
      if (!s || !s.resume) continue
      const bin = firstUsableCandidate(s.cli)
      if (!bin) continue                              // binary absent → can't warm
      if (s.cli === 'coco') await verifyCocoAsync(bin)
      if (hasLivePty(id)) continue                    // raced: another path spawned it
      try {
        spawnAndRegister(s, WARM_GEOM, { onExit: () => pool?.noteExited(id) })
        pool!.add(id)
      } catch { /* one bad session never aborts the pool */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_WARM, ids.length) }, () => worker()))
}
