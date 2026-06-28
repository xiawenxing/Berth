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
 * file is named <token>.json) and {token → cb.sessionId} is GROUND TRUTH — the hook ran inside the
 * real session's process, which was launched with BERTH_LAUNCH_TOKEN = this intent id. So channel A is
 * AUTHORITATIVE over channel B's heuristic (per-cwd FIFO + 90s window): if B raced ahead and bound the
 * intent to a DIFFERENT session (concurrent same-cwd, out-of-order rollouts), A corrects it — drops the
 * stale edge and re-keys the live pty off the wrong session id, then binds the true one. Returns true
 * iff it bound or corrected; false for an unknown token or an already-correct binding (idempotent).
 * `rekey` is injected for testability.
 */
export function ingestCallback(
  store: Store,
  token: string,
  cb: LaunchCallback,
  deps: { rekey: (oldKey: string, newKey: string) => void },
): boolean {
  const intent = store.getLaunchIntent(token)
  if (!intent || intent.cli !== 'codex') return false
  if (intent.bound && intent.sessionId === cb.sessionId) return false   // already correctly bound — idempotent
  // The pty currently lives under the wrong session id (if B mis-bound) or the intent id (not yet bound).
  const oldKey = intent.bound && intent.sessionId ? intent.sessionId : intent.id
  // Correcting a mis-binding: drop B's stale edge before writing the authoritative one.
  if (intent.bound && intent.sessionId && intent.sessionId !== cb.sessionId && intent.todoKey)
    store.removeEdge(intent.todoKey, intent.sessionId)
  bindIntentToSession(store, intent, cb.sessionId)
  deps.rekey(oldKey, cb.sessionId)
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
