import { WriteQueue } from './writeQueue'

// One process-wide serial writer for all bitable mutations.
let q: WriteQueue | null = null
export function getQueue(): WriteQueue {
  if (!q) { q = new WriteQueue({ spacingMs: 800, run: async (job) => { await (job.payload as any).exec() } }) }
  return q
}

// In-flight coalescing by logical key, and a monotonic counter for unique queue keys.
const inflight = new Map<string, Promise<any>>()
let seq = 0

/**
 * Enqueue a write and await its result. Serializes behind all other bitable writes (>=spacing apart).
 *
 * Concurrent calls with the SAME `key` are coalesced to a single in-flight write whose result both
 * awaiters receive (idempotent — prevents duplicate bitable rows from a double-submit). Once that
 * write settles the key is freed, so the same logical write can be issued again later.
 *
 * The job handed to WriteQueue uses a UNIQUE key (`key#<seq>`) so WriteQueue's own idempotency
 * `seen` Set never drops it — otherwise a dropped job would leave this Promise unresolved forever.
 */
export function enqueueWrite<T>(key: string, exec: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const p = new Promise<T>((resolve, reject) => {
    getQueue().enqueue({
      key: `${key}#${seq++}`,
      payload: { exec: async () => { try { resolve(await exec()) } catch (e) { reject(e); throw e } } },
    })
  }).finally(() => { inflight.delete(key) })

  inflight.set(key, p)
  return p
}
