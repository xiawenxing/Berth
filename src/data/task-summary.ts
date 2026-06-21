// Structured 任务进展详情 generation, plus the in-flight registry that drives the card's loading
// indicator. Lives in the data layer (deps: docstore / context-doc / agent / i18n — never tasks.ts)
// so `updateTask` can fire-and-forget a regeneration on status change without a circular import.

import { getDocStore } from './docstore'
import { ensureContextDoc } from './context-doc'
import { resolveBerthAgent } from './agent-config'
import { getLocale, contextStrings } from '../i18n'
import { generateStructuredSummary, type StructuredSummary } from '../agent/index'
import { meaningfulDocLength, TASK_DOC_MIN_MEANINGFUL, assembleTaskSummaryInput } from './summary-input'

type Store = ReturnType<typeof import('../db/store').openStore>

// Task ids whose summary is being (re)generated right now. Surfaced via GET /api/todos (and the
// summary-detail GET) so the UI can show a loading icon at the task's 摘要 position.
const inFlight = new Set<string>()
export function isSummarizingTask(id: string): boolean { return inFlight.has(id) }

// Provider injection: the data layer must not import the server's session cache directly. The server
// (store-singleton) registers a function here at startup that returns up to `budget` chars of the
// transcript text for the sessions linked to a task (via edges). Returns '' when nothing is linked
// or no provider is registered (e.g. in unit tests).
export type TaskTranscriptProvider = (store: Store, taskId: string, budget: number) => string
let transcriptProvider: TaskTranscriptProvider | null = null
export function setTaskTranscriptProvider(fn: TaskTranscriptProvider | null) { transcriptProvider = fn }

const TRANSCRIPT_BUDGET = 6000   // chars of linked-session transcript pulled in when the doc is thin

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
  // When the context doc is too thin to summarize on its own, supplement it with the transcript of
  // the task's linked sessions (edges) so the summary still reflects real work that happened there.
  const strings = contextStrings(locale)
  let input = content
  let maxChars = 4000
  if (meaningfulDocLength(content) < TASK_DOC_MIN_MEANINGFUL && transcriptProvider) {
    const excerpt = transcriptProvider(store, task.id, TRANSCRIPT_BUDGET)
    if (excerpt.trim()) {
      input = assembleTaskSummaryInput(content, excerpt, strings.summarySessionSection)
      maxChars = 4000 + TRANSCRIPT_BUDGET
    }
  }
  const summary = await generateStructuredSummary(input, strings.taskSummaryDetailPrompt, resolveBerthAgent(store), maxChars)
  if (!summary.headline && !summary.progress.length && !summary.milestones.length)
    throw new Error('agent returned empty summary')
  const generatedAt = Date.now()
  store.setTaskSummary(task.id, JSON.stringify(summary), generatedAt)
  // Merged generation: the headline doubles as the card's one-line 进展摘要 (A field).
  if (summary.headline) store.updateTaskFields(task.id, { progress: summary.headline }, Date.now())
  return { summary, generatedAt }
}

/** Fire-and-forget (re)generation — used by both the status-change hook and the manual popover POST.
 *  The in-flight flag is set synchronously (so a reload / GET right after already shows the loading
 *  icon), but the actual generation is deferred to a microtask and detached from any request: the
 *  triggering updateTask() returns and commits its own updated_at first, untouched by the summary's
 *  later progress/detailDoc writes, and closing the popover never stops the run. Dedups per task;
 *  errors are swallowed so a failed agent run never breaks the status update that triggered it.
 *  Returns true if it started a run, false if one was already in flight. */
export function triggerTaskSummary(store: Store, taskId: string): boolean {
  if (inFlight.has(taskId)) return false
  inFlight.add(taskId)
  queueMicrotask(() => {
    void generateTaskSummary(store, taskId).catch(() => {}).finally(() => inFlight.delete(taskId))
  })
  return true
}
