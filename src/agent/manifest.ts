import { join } from 'node:path'
import type { Task } from '../data/types'
import { manifestStrings, contextStrings, DEFAULT_LOCALE, type Locale } from '../i18n'

// Budget constants
const PROGRESS_BUDGET = 600   // max chars per progress block
const TOTAL_BUDGET = 3000     // max chars for total manifest text

export interface TaskManifestInput {
  kind: 'task'
  projectName: string
  docsRoot: string            // absolute Berth docs root; detail refs are relative to it
  todo: Task
  contextDocPath?: string | null
  protocolPath?: string | null
  compactRules?: string[]
}

export interface ProjectManifestInput {
  kind: 'project'
  projectName: string
  docsRoot: string
  projectTodos: Pick<Task, 'title' | 'detailDoc'>[]
  contextDocPath?: string | null
  protocolPath?: string | null
  compactRules?: string[]
}

export type ManifestInput = TaskManifestInput | ProjectManifestInput

export interface ManifestOutput {
  text: string
  addDirs: string[]
}

/**
 * Resolve an internal doc ref (path relative to docsRoot) to an absolute filesystem path the agent
 * can Read. detail refs are Berth-internal now (external link formats live in the adapters).
 */
export function detailRefToPath(ref: string | null | undefined, docsRoot: string): string | null {
  if (!ref) return null
  return join(docsRoot, ref)
}

/**
 * Build a non-LLM context manifest for a fresh agent session.
 * Returns structured index text (progressive disclosure) + add-dirs.
 */
export function buildManifest(input: ManifestInput, locale: Locale = DEFAULT_LOCALE): ManifestOutput {
  const { docsRoot } = input
  const m = manifestStrings(locale)

  const lines: string[] = []

  // Opening framing line
  const kindLabel = input.kind === 'task' ? m.kindTask : m.kindProject
  lines.push(m.framing(kindLabel))
  lines.push('')

  if (input.kind === 'task') {
    const { todo, projectName } = input

    lines.push(m.sectionTask)
    lines.push(`${m.labelTitle}${todo.title}`)
    lines.push(`${m.labelStatus}${todo.status ?? '—'}`)
    lines.push(`${m.labelPriority}${todo.priority ?? '—'}`)
    lines.push(`${m.labelProject}${projectName}`)

    if (todo.detailDoc) {
      const detailPath = detailRefToPath(todo.detailDoc, docsRoot)
      if (detailPath) {
        lines.push(`${m.labelDetailDoc}${detailPath}`)
      }
    }

    if (todo.progress) {
      const truncated = todo.progress.length > PROGRESS_BUDGET
        ? todo.progress.slice(0, PROGRESS_BUDGET) + '…'
        : todo.progress
      lines.push('')
      lines.push(m.sectionProgress)
      lines.push(truncated)
    }

  } else {
    // project kind
    const { projectName, projectTodos } = input

    lines.push(m.projectHeading(projectName))
    lines.push('')
    lines.push(m.pendingDetailDocs)

    for (const todo of projectTodos) {
      if (todo.detailDoc) {
        const detailPath = detailRefToPath(todo.detailDoc, docsRoot)
        if (detailPath) {
          lines.push(`- ${todo.title}: ${detailPath}`)
        } else {
          lines.push(`- ${todo.title}: ${m.noDetailDoc}`)
        }
      } else {
        lines.push(`- ${todo.title}: ${m.noDetailDoc}`)
      }
    }
  }

  // Maintenance block (the §6 compact rules + context/protocol paths) + footer form a PROTECTED tail:
  // they carry the load-bearing rules and the abs paths the agent must Read, so they must survive
  // budget truncation. Build them separately and only truncate the (variable-length) index body —
  // otherwise a large project todo list could sever the path lines, leaving rules that dangle.
  // buildManifest stays pure — pty-ws ensures the files and passes the abs paths in.
  const tail: string[] = []
  if (input.compactRules && input.compactRules.length) {
    const c = contextStrings(locale)
    tail.push('')
    tail.push(c.sectionMaintain)
    for (const r of input.compactRules) tail.push(r)
    if (input.contextDocPath) tail.push(`${c.labelContextDoc}${input.contextDocPath}`)
    if (input.protocolPath) tail.push(`${c.labelProtocol}${input.protocolPath}`)
  }
  tail.push('')
  tail.push(m.footer)
  const tailText = tail.join('\n')

  let body = lines.join('\n')
  const bodyBudget = TOTAL_BUDGET - tailText.length
  if (body.length > bodyBudget) {
    body = body.slice(0, Math.max(0, bodyBudget)) + m.truncated
  }
  const text = body + '\n' + tailText

  return {
    text,
    addDirs: [docsRoot],
  }
}
