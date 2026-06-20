// Structured 项目小结 generation + an in-flight registry, mirroring task-summary.ts. Generation runs
// detached from the HTTP request that kicked it (fire-and-forget), so closing the popover never stops
// it; the popover polls the GET endpoint, which reports `summarizing` from this registry.

import { getDocStore } from './docstore'
import { ensureContextDoc } from './context-doc'
import { resolveBerthAgent } from './agent-config'
import { getLocale, contextStrings } from '../i18n'
import { generateStructuredSummary, type StructuredSummary } from '../agent/index'

type Store = ReturnType<typeof import('../db/store').openStore>

const inFlight = new Set<string>()
export function isSummarizingProject(id: string): boolean { return inFlight.has(id) }

/** Generate + persist the structured project summary. Throws on agent failure / empty result;
 *  returns null if the project is gone. */
export async function generateProjectSummary(store: Store, projectId: string): Promise<{ summary: StructuredSummary; generatedAt: number } | null> {
  const project = store.getProject(projectId)
  if (!project) return null
  const ds = getDocStore(store)
  const locale = getLocale(store)
  const ensured = ensureContextDoc(ds, 'project', project.name, { title: project.name, projectName: project.name, locale })
  const { content } = ds.readDoc(ensured.abs)
  const summary = await generateStructuredSummary(content, contextStrings(locale).projectSummaryPrompt, resolveBerthAgent(store))
  if (!summary.headline && !summary.progress.length && !summary.milestones.length)
    throw new Error('agent returned empty summary')
  const generatedAt = Date.now()
  store.setProjectSummary(projectId, JSON.stringify(summary), generatedAt)
  return { summary, generatedAt }
}

/** Fire-and-forget (re)generation. The in-flight flag is set synchronously so an immediate GET sees
 *  `summarizing: true`; the work itself is deferred to a microtask and detached from any request.
 *  Dedups per project; errors are swallowed (the popover surfaces failure via the cleared flag +
 *  unchanged cache). Returns true if it started a run, false if one was already in flight. */
export function triggerProjectSummary(store: Store, projectId: string): boolean {
  if (inFlight.has(projectId)) return false
  inFlight.add(projectId)
  queueMicrotask(() => {
    void generateProjectSummary(store, projectId).catch(() => {}).finally(() => inFlight.delete(projectId))
  })
  return true
}
