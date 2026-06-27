import type { openStore } from '../db/store'
import type { LaunchCallback } from './launch-callback'
import { bindIntentToSession } from './bind'

type Store = ReturnType<typeof openStore>

/**
 * Bind a codex launch from its SessionStart callback. `token` is the launch intent id (the callback
 * file is named <token>.json). Returns true iff a pending intent named by the token was bound.
 * `rekey` moves the live pty from the intent id to the real session id (injected for testability).
 */
export function ingestCallback(
  store: Store,
  token: string,
  cb: LaunchCallback,
  deps: { rekey: (oldKey: string, newKey: string) => void },
): boolean {
  const intent = store.pendingIntents().find(i => i.id === token && i.cli === 'codex')
  if (!intent) return false
  bindIntentToSession(store, intent, cb.sessionId)
  deps.rekey(intent.id, cb.sessionId)
  return true
}
