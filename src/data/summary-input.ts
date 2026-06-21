// Pure helpers that assemble the text fed to the structured-summary agent. Kept side-effect-free
// (no fs / store / agent deps) so they unit-test in isolation. Used by task-summary.ts and
// project-summary.ts to decide whether a context doc is too thin and to build the combined input.

import type { StructuredSummary } from '../agent/index'

/** Count the "meaningful" body characters in a context doc: everything that is NOT a markdown
 *  heading, an HTML comment (the template scaffolding), or blank. A freshly-created doc from the
 *  template scores ~0; once the user/agent fills real prose in, it climbs. Used to decide whether
 *  the task context is too thin to summarize on its own. */
export function meaningfulDocLength(content: string): number {
  let n = 0
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) continue          // headings (## 目标 …)
    if (line.startsWith('<!--')) continue        // template hint comments
    n += line.length
  }
  return n
}

/** A context doc is "insufficient" when its meaningful body is below this many chars — at that point
 *  the task summary is better served by pulling in the linked sessions' transcripts. */
export const TASK_DOC_MIN_MEANINGFUL = 80

/** Build the agent input for a task summary, optionally appending the linked sessions' transcript
 *  excerpt under a labeled section when the context doc alone is too thin. */
export function assembleTaskSummaryInput(doc: string, sessionExcerpt: string, sectionLabel: string): string {
  const extra = sessionExcerpt.trim()
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
