import { mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { openStore } from '../db/store'
import type { LaunchCallback } from './launch-callback'
import { bindIntentToSession } from './bind'
import { rekeyPty } from './pty-registry'
import { logDiag } from './diag'
import { parseLaunchCallback } from './launch-callback'

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

/**
 * Process one callback file (named <token>.json): parse, bind if a pending intent matches, remove.
 * A partial/invalid file is LEFT in place so a later fs.watch event or the startup scan retries it
 * once the hook finishes writing. A parseable file is removed whether or not it bound — a callback
 * with no matching pending intent is stale/redundant (channel B may have already bound it), so we
 * don't let the dir accumulate. Best-effort throughout: never throws into the watcher.
 *
 * A file whose content never becomes a valid SessionStart envelope (a permanently-malformed drop)
 * therefore persists until manually cleared — but channel B (reconcile) binds the session regardless,
 * so this stray file is harmless and the trade-off is acceptable.
 */
function processCallbackFile(store: Store, dir: string, file: string): void {
  if (!file.endsWith('.json')) return
  const path = join(dir, file)
  let cb: ReturnType<typeof parseLaunchCallback>
  try { cb = parseLaunchCallback(readFileSync(path, 'utf8')) } catch { return }
  if (!cb) return   // partial write / not yet flushed — leave for the next event or the scan
  const token = file.slice(0, -'.json'.length)
  try {
    if (ingestCallback(store, token, cb, { rekey: rekeyPty }))
      logDiag({ category: 'reconcile', event: 'callback_bind', sessionId: cb.sessionId, cli: 'codex', intentId: token })
  } catch { /* binding is best-effort */ }
  try { rmSync(path, { force: true }) } catch { /* best-effort */ }
}

/** Scan any callback files already on disk (dropped while Berth was down). Call once at startup. */
export function scanLaunchCallbacks(store: Store, dir: string): void {
  try { mkdirSync(dir, { recursive: true }) } catch {}
  let files: string[] = []
  try { files = readdirSync(dir) } catch { return }
  for (const f of files) processCallbackFile(store, dir, f)
}

/** Watch the callback dir for new drops. Returns a stop fn. macOS fires 'rename' on create. */
export function startLaunchCallbackWatch(store: Store, dir: string): () => void {
  try { mkdirSync(dir, { recursive: true }) } catch {}
  const w = watch(dir, (_event, filename) => {
    if (filename) processCallbackFile(store, dir, filename.toString())
  })
  w.unref()
  return () => w.close()
}
