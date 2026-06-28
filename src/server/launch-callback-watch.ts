import { mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { openStore } from '../db/store'
import type { LaunchCallback } from './launch-callback'
import { bindIntentToSession } from './bind'
import { rekeyPty, hasLivePty } from './pty-registry'
import { logDiag } from './diag'
import { parseLaunchCallback } from './launch-callback'

type Store = ReturnType<typeof openStore>

/**
 * Bind a codex launch from its SessionStart callback. `token` is the launch intent id (the callback
 * file is named <token>.json) and {token → cb.sessionId} is GROUND TRUTH — the hook ran inside the
 * real session's process, which was launched with BERTH_LAUNCH_TOKEN = this intent id. So channel A is
 * AUTHORITATIVE over channel B's heuristic (per-cwd FIFO + 90s window): if B raced ahead and bound the
 * intent to a DIFFERENT session (concurrent same-cwd, out-of-order rollouts), A corrects it. It makes the
 * EDGES authoritative — drops the intent's stale edge AND any OTHER todo wrongly holding the true session
 * (B's cross-edge, so a double-bind can't survive even if the sibling's A callback never fires) — then
 * binds the true one. The live-pty rekey is best-effort and collision-safe: if a live pty already
 * occupies the target session key (the rare both-callbacks concurrent swap), the rekey is SKIPPED rather
 * than killing that sibling agent; live terminal routing may then point a task at its sibling's running
 * agent until the next restart, but the durable edges are correct and routing self-heals on restart.
 * Returns true iff it bound or corrected; false for an unknown token or an already-correct binding
 * (idempotent). `rekey`/`isLive` are injected for testability.
 */
export function ingestCallback(
  store: Store,
  token: string,
  cb: LaunchCallback,
  deps: { rekey: (oldKey: string, newKey: string) => void; isLive: (key: string) => boolean },
): boolean {
  const intent = store.getLaunchIntent(token)
  if (!intent || intent.cli !== 'codex') return false
  if (intent.bound && intent.sessionId === cb.sessionId) return false   // already correct — idempotent
  const correcting = intent.bound && !!intent.sessionId && intent.sessionId !== cb.sessionId
  const oldKey = correcting ? intent.sessionId! : intent.id
  if (correcting) {
    // A is ground truth: {token → cb.sessionId}, and that session belongs to exactly this intent's
    // todo. Drop the intent's stale edge AND any OTHER todo wrongly holding the true session (B's
    // cross-edge), so neither a stale nor a double binding survives even if the sibling's A never fires.
    if (intent.todoKey) store.removeEdge(intent.todoKey, intent.sessionId!)
    store.removeEdgesForSession(cb.sessionId)
  }
  bindIntentToSession(store, intent, cb.sessionId)
  // Move the live pty to the true key — but NEVER if a live pty already occupies it (a concurrent-swap
  // collision): killing that sibling agent is worse than imperfect live routing, which self-heals on
  // restart now that the edges are authoritative. First-bind: target key is a fresh session, never live.
  if (oldKey !== cb.sessionId && !deps.isLive(cb.sessionId)) deps.rekey(oldKey, cb.sessionId)
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
    if (ingestCallback(store, token, cb, { rekey: rekeyPty, isLive: hasLivePty }))
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
