import type { openStore } from '../db/store'
import type { AgentCli } from '../types'

type Store = ReturnType<typeof openStore>
import { getTaskFieldConfig, resolveStatusRoles } from '../data/task-config'
import { listTasks, updateTask } from '../data/tasks'
import { parseTranscriptTurns } from './transcript-turns'
import { parseStatusSentinel, decideTaskStatusReconcile } from './task-status-sentinel'
import { subscribeActivity } from './pty-registry'
import { logDiag } from './diag'

export interface SessionRef { sessionId: string; cli: AgentCli; contentSourcePath: string | null }

/** Read the latest agent turn's text from a session transcript (empty string if none). */
function latestAgentText(cli: AgentCli, contentSourcePath: string | null): string {
  const turns = parseTranscriptTurns(cli, contentSourcePath)
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'agent') return turns[i].text
  return ''
}

/**
 * Path B reconcile for one session. Looks up the bound task; if it's still in the in-progress role,
 * parses the sentinel from the latest agent turn and applies the agent's decided status. Idempotent.
 */
export function reconcileTaskStatusForSession(args: {
  store: Store
  sessionId: string
  getSession: (sessionId: string) => SessionRef | null
  now?: () => number
}): void {
  const { store, sessionId, getSession } = args
  const todoKey = store.todoKeyForSession(sessionId)
  if (!todoKey) return
  const task = listTasks(store).find(t => t.id === todoKey)
  if (!task) return

  const cfg = getTaskFieldConfig(store)
  const { inProgress } = resolveStatusRoles(cfg)
  // Fast path: if it already moved off in-progress, Path A worked — don't even read the transcript.
  if (!inProgress || task.status !== inProgress) return

  const session = getSession(sessionId)
  if (!session?.contentSourcePath) return
  const sentinelStatus = parseStatusSentinel(latestAgentText(session.cli, session.contentSourcePath), todoKey, cfg.statuses)
  const decided = decideTaskStatusReconcile({ currentStatus: task.status, inProgress, sentinelStatus })
  if (decided && decided !== task.status) {
    updateTask(store, todoKey, { status: decided }, args.now ?? Date.now)
    logDiag({ category: 'reconcile', event: 'task_status_flow', sessionId, todoKey, status: decided } as any)
  }
}

/**
 * Subscribe to the activity FSM. When a bound session settles, debounce, then reconcile. The debounce
 * gives Path A (the agent's own `berth task` call) time to land before the engine fallback runs.
 */
export function startTaskStatusFlow(args: {
  store: Store
  getSession: (sessionId: string) => SessionRef | null
  debounceMs?: number
}): () => void {
  const { store, getSession } = args
  const debounceMs = args.debounceMs ?? 5000
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const unsub = subscribeActivity(e => {
    if (e.kind !== 'state') return
    const sid = e.sessionId
    if (e.state === 'running') { const x = timers.get(sid); if (x) { clearTimeout(x); timers.delete(sid) } ; return }
    if (e.state !== 'settled' && e.state !== 'exited') return
    const prev = timers.get(sid); if (prev) clearTimeout(prev)
    timers.set(sid, setTimeout(() => {
      timers.delete(sid)
      try { reconcileTaskStatusForSession({ store, sessionId: sid, getSession }) } catch (err: any) {
        logDiag({ category: 'reconcile', event: 'task_status_flow_error', sessionId: sid, level: 'warn', message: String(err?.message ?? err) } as any)
      }
    }, debounceMs))
  })
  return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); unsub() }
}
