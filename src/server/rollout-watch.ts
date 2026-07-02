import { existsSync, readdirSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { rekeyPty } from './pty-registry'
import { logDiag } from './diag'
import { bindIntentToSession } from './bind'
import { parseSessionMeta, matchRolloutToIntent } from './rollout-match'
import type { openStore } from '../db/store'

type Store = ReturnType<typeof openStore>

export const ROLLOUT_POLL_MS = 5_000   // coarse fallback — do NOT shrink (perf); only runs while a codex intent is unbound

/** The codex rollout dir for a given Date: <codexHome>/sessions/YYYY/MM/DD. Pure (date injected). */
export function rolloutDayDir(now: Date, codexHome = join(homedir(), '.codex')): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return join(codexHome, 'sessions', String(y), m, d)
}

/** Read a rollout file's first line and bind it to a pending intent if it matches. Best-effort.
 *  `deps.rekey` is injectable (defaults to the real `rekeyPty`) so tests can assert the rekey. */
export function bindFromRollout(
  store: Store,
  path: string,
  deps: { rekey: (oldKey: string, newKey: string) => void } = { rekey: rekeyPty },
): boolean {
  let meta: ReturnType<typeof parseSessionMeta> = null
  try { meta = parseSessionMeta(readFileSync(path, 'utf8').split('\n', 1)[0] ?? '') } catch { return false }
  if (!meta) return false
  const pending = store.pendingIntents().filter(i => i.cli === 'codex')
  const id = matchRolloutToIntent(pending, { cwd: meta.cwd, startedAtSec: meta.startedAtSec }, 90)
  if (!id) return false
  const intent = pending.find(i => i.id === id)!
  bindIntentToSession(store, intent, meta.sessionId)
  deps.rekey(intent.id, meta.sessionId)
  logDiag({ category: 'reconcile', event: 'rollout_bind', sessionId: meta.sessionId, cli: 'codex', intentId: intent.id })
  return true
}

/** Scan a rollout dir once, binding any rollout whose session_meta matches a pending intent. */
function scanDir(store: Store, dir: string): void {
  try { for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) bindFromRollout(store, join(dir, f)) } catch {}
}

let watcher: { close(): void } | null = null
let poll: ReturnType<typeof setInterval> | null = null
let watchedDir = ''

/** Arm the rollout watch IFF there is a pending codex intent; disarm otherwise. Idempotent — safe to
 *  call from every refresh(). A coarse 5s poll is armed once per day-dir (stable across the ~500ms
 *  refresh cadence); the faster fs.watch is upgraded in lazily once today's dir exists. Re-points at
 *  the new dir when the day rolls over. */
export function syncRolloutWatch(store: Store, now: () => Date = () => new Date()): void {
  const hasPending = store.pendingIntents().some(i => i.cli === 'codex')
  if (!hasPending) { disarm(); return }
  const dir = rolloutDayDir(now())
  if (dir !== watchedDir) {
    // First arm, or the day rolled over → tear down and re-arm the coarse poll for the new dir.
    disarm()
    watchedDir = dir
    poll = setInterval(() => {
      if (!store.pendingIntents().some(i => i.cli === 'codex')) { disarm(); return }
      syncRolloutWatch(store, now)   // re-point at midnight + lazily arm the watcher once dir exists
      scanDir(store, dir)
    }, ROLLOUT_POLL_MS)
    ;(poll as { unref?: () => void }).unref?.()
  }
  // Upgrade to fs.watch (faster than the poll) the moment today's dir exists — without disturbing the
  // poll. The `dir !== watchedDir` guard above keeps this stable across the 500ms refresh cadence.
  if (!watcher && existsSync(dir)) {
    try {
      const w = watch(dir, (_e, file) => { if (file && file.toString().endsWith('.jsonl')) bindFromRollout(store, join(dir, file.toString())) })
      ;(w as { unref?: () => void }).unref?.()
      watcher = w
    } catch { /* watch unsupported/failed → poll covers it */ }
  }
}

function disarm(): void {
  try { watcher?.close() } catch {}
  if (poll) clearInterval(poll)
  watcher = null; poll = null; watchedDir = ''
}
