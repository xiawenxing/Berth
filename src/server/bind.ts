import type { openStore } from '../db/store'
import type { LaunchIntent } from '../types'

type Store = ReturnType<typeof openStore>

/**
 * The store-write half of binding a launch intent to a real session id: edge (if task-bound),
 * attach (only for a REAL project — a null-project attach has no consumer and mis-curates), and
 * mark the intent bound. Idempotent (addEdge is INSERT OR IGNORE; bindIntent is a plain UPDATE).
 * Pure w.r.t. the pty-registry — callers do rekeyPty/logDiag themselves.
 */
export function bindIntentToSession(store: Store, intent: LaunchIntent, sessionId: string): void {
  if (intent.todoKey !== null) store.addEdge(intent.todoKey, sessionId)
  if (intent.projectId) store.setAttach(sessionId, intent.projectId, 'confirmed')
  store.bindIntent(intent.id, sessionId)
}
