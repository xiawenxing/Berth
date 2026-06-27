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

/** Read a rollout file's first line and bind it to a pending intent if it matches. Best-effort. */
export function bindFromRollout(store: Store, path: string): boolean {
  let meta: ReturnType<typeof parseSessionMeta> = null
  try { meta = parseSessionMeta(readFileSync(path, 'utf8').split('\n', 1)[0] ?? '') } catch { return false }
  if (!meta) return false
  const pending = store.pendingIntents().filter(i => i.cli === 'codex')
  const id = matchRolloutToIntent(pending, { cwd: meta.cwd, startedAtSec: meta.startedAtSec }, 90)
  if (!id) return false
  const intent = pending.find(i => i.id === id)!
  bindIntentToSession(store, intent, meta.sessionId)
  rekeyPty(intent.id, meta.sessionId)
  logDiag({ category: 'reconcile', event: 'rollout_bind', sessionId: meta.sessionId, cli: 'codex', intentId: intent.id })
  return true
}

let watcher: { close(): void } | null = null
let poll: ReturnType<typeof setInterval> | null = null
let watchedDir = ''

/** Arm the rollout watch IFF there is a pending codex intent; disarm otherwise. Idempotent — safe to
 *  call from every refresh(). The watch re-points when the day rolls over (dir path changes). */
export function syncRolloutWatch(store: Store, now: () => Date = () => new Date()): void {
  const hasPending = store.pendingIntents().some(i => i.cli === 'codex')
  if (!hasPending) { disarm(); return }
  const dir = rolloutDayDir(now())
  if (watcher && dir === watchedDir) return     // already watching the right dir
  disarm()
  watchedDir = dir
  const scanDir = () => { try { for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) bindFromRollout(store, join(dir, f)) } catch {} }
  try {
    if (existsSync(dir)) {
      const w = watch(dir, (_e, file) => { if (file && file.toString().endsWith('.jsonl')) bindFromRollout(store, join(dir, file.toString())) })
      ;(w as { unref?: () => void }).unref?.()
      watcher = w
    }
  } catch { /* watch unsupported/failed → poll covers it */ }
  // Coarse poll fallback (also covers: dir didn't exist when we tried to watch; day rollover).
  poll = setInterval(() => { if (!store.pendingIntents().some(i => i.cli === 'codex')) { disarm(); return } syncRolloutWatch(store, now); scanDir() }, ROLLOUT_POLL_MS)
  ;(poll as { unref?: () => void }).unref?.()
}

function disarm(): void {
  try { watcher?.close() } catch {}
  if (poll) clearInterval(poll)
  watcher = null; poll = null; watchedDir = ''
}
