// Structured 任务进展详情 generation, plus the in-flight registry that drives the card's loading
// indicator. Lives in the data layer (deps: docstore / context-doc / agent / i18n — never tasks.ts)
// so `updateTask` can fire-and-forget a regeneration on status change without a circular import.

import { getDocStore } from './docstore'
import { ensureContextDoc } from './context-doc'
import { resolveBerthAgent } from './agent-config'
import { getLocale, contextStrings } from '../i18n'
import { generateStructuredSummary, type StructuredSummary } from '../agent/index'

type Store = ReturnType<typeof import('../db/store').openStore>

// Task ids whose summary is being (re)generated right now. Surfaced via GET /api/todos so the UI can
// show a loading icon at the task's 摘要 position; cleared in `runTaskSummary`'s finally.
const inFlight = new Set<string>()
export function isSummarizingTask(id: string): boolean { return inFlight.has(id) }

/** Generate + persist the structured task summary, writing the headline back to `progress` (the card's
 *  one-line 进展摘要). Uses store.updateTaskFields directly (not updateTask) to avoid re-triggering the
 *  status-change hook. Throws on agent failure / empty result; returns null if the task is gone. */
export async function generateTaskSummary(store: Store, taskId: string): Promise<{ summary: StructuredSummary; generatedAt: number } | null> {
  const task = store.getTask(taskId)
  if (!task) return null
  const ds = getDocStore(store)
  const locale = getLocale(store)
  const ensured = ensureContextDoc(ds, 'task', task.id, { title: task.title, projectName: task.project, locale })
  if (ensured.created && !task.detailDoc) store.updateTaskFields(task.id, { detailDoc: ensured.ref }, Date.now())
  const { content } = ds.readDoc(ensured.abs)
  const summary = await generateStructuredSummary(content, contextStrings(locale).taskSummaryDetailPrompt, resolveBerthAgent(store))
  if (!summary.headline && !summary.progress.length && !summary.milestones.length)
    throw new Error('agent returned empty summary')
  const generatedAt = Date.now()
  store.setTaskSummary(task.id, JSON.stringify(summary), generatedAt)
  // Merged generation: the headline doubles as the card's one-line 进展摘要 (A field).
  if (summary.headline) store.updateTaskFields(task.id, { progress: summary.headline }, Date.now())
  return { summary, generatedAt }
}

/** Generate while holding the in-flight flag (so the UI shows a loading icon). Awaited by the manual
 *  endpoint; the auto-trigger fires it in the background. */
export async function runTaskSummary(store: Store, taskId: string): Promise<{ summary: StructuredSummary; generatedAt: number } | null> {
  inFlight.add(taskId)
  try {
    return await generateTaskSummary(store, taskId)
  } finally {
    inFlight.delete(taskId)
  }
}

/** Fire-and-forget regeneration for the status-change hook. The in-flight flag is set synchronously
 *  (so a reload right after the status change already shows the loading icon), but the actual
 *  generation is deferred to a microtask — the triggering updateTask() returns and commits its own
 *  updated_at first, untouched by the summary's later progress/detailDoc writes. Dedups per task;
 *  errors are swallowed so a failed agent run never breaks the status update that triggered it. */
export function triggerTaskSummary(store: Store, taskId: string): void {
  if (inFlight.has(taskId)) return
  inFlight.add(taskId)
  queueMicrotask(() => {
    void generateTaskSummary(store, taskId).catch(() => {}).finally(() => inFlight.delete(taskId))
  })
}
