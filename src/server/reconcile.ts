import type { LogicalSession } from '../types'
import type { openStore } from '../db/store'
import { rekeyPty } from './pty-registry'
import { canonicalPathKey } from '../path-normalize'

type Store = ReturnType<typeof openStore>

// Match cwd using real paths where possible so aliases like /tmp and /private/tmp bind together.
function normPath(p: string): string {
  return canonicalPathKey(p)
}

/**
 * For each pending codex LaunchIntent, find the best matching LogicalSession
 * in `cache` and bind them together (addEdge + setAttach + bindIntent).
 *
 * Matching criteria:
 *   - session.cli === 'codex'
 *   - normPath(session.cwd) === normPath(intent.cwd)
 *   - session.updatedAt >= intent.createdAt
 *   - session not already edge-bound (todoKeyForSession === null)
 *   - session not already attached (getAttach === null)
 *   - session not already claimed by a previous intent in this same pass
 *
 * Among candidates pick the one with the highest updatedAt. If none found, the
 * intent stays pending and will be retried on the next refresh.
 */
export function reconcileLaunchIntents(store: Store, cache: LogicalSession[]): number {
  const pending = store.pendingIntents()
    .filter(i => i.cli === 'codex')
    .sort((a, b) => b.createdAt - a.createdAt)
  if (pending.length === 0) return 0

  // Track which sessions have been claimed in this pass so two intents cannot
  // compete for the same session.
  const used = new Set<string>()
  let bound = 0

  for (const intent of pending) {
    const normIntentCwd = normPath(intent.cwd)

    const candidates = cache.filter(s => {
      if (s.cli !== 'codex') return false
      if (s.cwd == null) return false
      if (normPath(s.cwd) !== normIntentCwd) return false
      if (s.updatedAt < intent.createdAt) return false
      if (store.todoKeyForSession(s.sessionId) !== null) return false
      if (store.getAttach(s.sessionId) !== null) return false
      if (used.has(s.sessionId)) return false
      return true
    })

    if (candidates.length === 0) continue

    // Pick the candidate with the highest updatedAt.
    const best = candidates.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))

    used.add(best.sessionId)

    if (intent.todoKey !== null) {
      // intent.todoKey is a Berth task id (post identity-migration), used directly as the edge key.
      store.addEdge(intent.todoKey, best.sessionId)
    }
    store.setAttach(best.sessionId, intent.projectId, 'confirmed')
    store.bindIntent(intent.id, best.sessionId)
    // The fresh codex pty was registered under the intent id; move it to the real session id so a
    // later click reattaches to the SAME live process instead of spawning a parallel `codex resume`.
    rekeyPty(intent.id, best.sessionId)
    bound += 1
  }
  return bound
}
