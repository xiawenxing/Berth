// src/server/context-consolidate-service.ts
// Server glue for §7 Phase-2 consolidation: resolve a session to its task/project context file,
// read the transcript, run the headless consolidation, and write the result back deterministically.
import { openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs'
import type { DocStore } from '../data/docstore'
import { ensureContextDoc, rotateContextDocOnDisk } from '../data/context-doc'
import { applyConsolidation } from '../data/context-apply'
import { consolidateContext } from '../agent/context-consolidate'
import { runAgent, type BerthAgent } from '../agent/index'
import { contextStrings, type Locale } from '../i18n'

export interface ContextTarget {
  kind: 'task' | 'project'; key: string; title: string; projectName: string | null; ref: string; abs: string
}

interface SessionLite { sessionId: string; todoKey: string | null; projectId: string | null; contentSourcePath?: string | null }
interface TaskLite { title: string; project: string | null }

/** Map a session to the context file it should maintain: its linked task, else its project, else null. */
export function resolveSessionContextTarget(session: SessionLite, task: TaskLite | null, docStore: DocStore): ContextTarget | null {
  if (session.todoKey && task) {
    const ref = docStore.taskDocRef(session.todoKey)
    return { kind: 'task', key: session.todoKey, title: task.title, projectName: task.project, ref, abs: docStore.resolveDocPath(ref)! }
  }
  if (session.projectId) {
    const ref = docStore.projectDocRef(session.projectId)
    return { kind: 'project', key: session.projectId, title: session.projectId, projectName: session.projectId, ref, abs: docStore.resolveDocPath(ref)! }
  }
  return null
}

function readTranscript(path: string | null | undefined, maxBytes = 200_000): string {
  if (!path || !existsSync(path)) return ''
  try {
    const fd = openSync(path, 'r'); const b = Buffer.alloc(maxBytes)
    const n = readSync(fd, b, 0, maxBytes, 0); closeSync(fd)
    return b.toString('utf8', 0, n)
  } catch { return '' }
}

export interface ConsolidationOutcome { ok: boolean; reason?: string; progress?: string; status?: string; rotated?: boolean }

/** Full consolidation for one session. */
export async function runConsolidation(args: {
  session: SessionLite; task: TaskLite | null; docStore: DocStore; locale: Locale; agent: BerthAgent
  getCfg: () => { logMaxLines: number; logKeep: number }
}): Promise<ConsolidationOutcome> {
  const { session, task, docStore, locale, agent } = args
  const target = resolveSessionContextTarget(session, task, docStore)
  if (!target) return { ok: false, reason: 'session not linked to a task or project' }
  ensureContextDoc(docStore, target.kind, target.key, { title: target.title, projectName: target.projectName, locale })
  const transcript = readTranscript(session.contentSourcePath)
  if (!transcript) return { ok: false, reason: 'no readable transcript' }
  const contextDoc = readFileSync(target.abs, 'utf8')
  const result = await consolidateContext({ kind: target.kind, contextDoc, transcript, locale, agent }, runAgent)
  if (!result.progress && !result.status) return { ok: false, reason: 'agent produced nothing to write' }
  const c = contextStrings(locale)
  const statusHeading = target.kind === 'task' ? c.statusHeadingTask : c.statusHeadingProject
  const newDoc = applyConsolidation(contextDoc, result, { logHeading: c.logHeading, statusHeading })
  docStore.writeDoc(target.abs, newDoc)
  const cfg = args.getCfg()
  const rotated = rotateContextDocOnDisk(docStore, target.abs, { maxLines: cfg.logMaxLines, keep: cfg.logKeep, locale })
  return { ok: true, progress: result.progress, status: result.status, rotated }
}
