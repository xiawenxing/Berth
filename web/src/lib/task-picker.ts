import type { ApiTask } from './api'
import { statusKind } from './status'

/**
 * Selectable tasks for the 起航 dialog's "任务" picker. We only offer tasks the user could
 * plausibly start: scoped to the launch's project (or all tasks when launched project-less),
 * excluding ones already done/cancelled, optionally narrowed by a title search. Input order is
 * preserved (the server already returns tasks sorted).
 */
export function filterTaskOptions(tasks: ApiTask[], projectId: string | undefined, query: string): ApiTask[] {
  const q = query.trim().toLowerCase()
  return tasks.filter((t) => {
    if (projectId && (t.projectId ?? undefined) !== projectId) return false
    const kind = statusKind(t.status)
    if (kind === 'done' || kind === 'cancelled') return false
    if (q && !t.title.toLowerCase().includes(q)) return false
    return true
  })
}
