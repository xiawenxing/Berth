// Pure helpers that assemble the text fed to the structured-summary agent. Kept side-effect-free
// (no fs / store / agent deps) so they unit-test in isolation. Used by task-summary.ts and
// project-summary.ts to decide whether a context doc is too thin and to build the combined input.

import type { StructuredSummary } from '../agent/index'

/** Build the agent input for a task summary: the context doc plus the linked sessions' conversation
 *  digest (user queries + agent textual replies) under a labeled section. The digest is always
 *  appended when present — the context doc and the session record are complementary sources. */
export function assembleTaskSummaryInput(doc: string, sessionDigest: string, sectionLabel: string): string {
  const extra = sessionDigest.trim()
  if (!extra) return doc
  return `${doc.trim()}\n\n${sectionLabel}\n${extra}\n`
}

export interface ProjectTaskLine {
  title: string
  status: string | null
  summary: StructuredSummary | null
}

/** Build the agent input for a project summary: the project context doc followed by a rendered list
 *  of the project's tasks, each with its status and (when available) its own summary headline +
 *  progress bullets. This is the "项目上下文 + 任务列表 + 任务总结" data source. */
export function assembleProjectSummaryInput(doc: string, tasks: ProjectTaskLine[], sectionLabel: string): string {
  if (!tasks.length) return doc
  const lines: string[] = ['', sectionLabel]
  for (const t of tasks) {
    const status = t.status ? `[${t.status}] ` : ''
    const headline = t.summary?.headline ? ` — ${t.summary.headline}` : ''
    lines.push(`- ${status}${t.title}${headline}`)
    for (const p of t.summary?.progress ?? []) lines.push(`  - ${p}`)
  }
  return `${doc.trim()}\n${lines.join('\n')}\n`
}
