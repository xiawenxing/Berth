// src/server/context-consolidate-service.ts
// Server glue for §7 context updates: resolve a session to its task/project context file, read the
// transcript, run the unified updater, and write the result back deterministically (then rotate).
import { openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs'
import type { DocStore } from '../data/docstore'
import { ensureContextDoc, rotateContextDocOnDisk } from '../data/context-doc'
import { updateContext } from '../agent/context-update'
import { headCommit } from '../data/doc-git'
import { runAgent, type BerthAgent } from '../agent/index'
import { type Locale } from '../i18n'

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

export function readTranscript(path: string | null | undefined, maxBytes = 200_000): string {
  if (!path || !existsSync(path)) return ''
  try {
    const fd = openSync(path, 'r'); const b = Buffer.alloc(maxBytes)
    const n = readSync(fd, b, 0, maxBytes, 0); closeSync(fd)
    return b.toString('utf8', 0, n)
  } catch { return '' }
}

export interface ContextUpdateOutcome {
  ok: boolean; reason?: string
  changed?: string[]; added?: string[]; removed?: string[]
  commit?: string | null; rotated?: boolean
}

/** Core: run the unified updater against a resolved context target, write + rotate, report the diff. */
export async function runContextUpdate(args: {
  target: ContextTarget; docStore: DocStore; locale: Locale; agent: BerthAgent
  userInput?: string; transcript?: string; date: string
  getCfg: () => { logMaxLines: number; logKeep: number }
}): Promise<ContextUpdateOutcome> {
  const { target, docStore, locale, agent } = args
  if (!args.userInput?.trim() && !args.transcript?.trim()) return { ok: false, reason: 'no input or transcript' }
  ensureContextDoc(docStore, target.kind, target.key, { title: target.title, projectName: target.projectName, locale })
  const contextDoc = readFileSync(target.abs, 'utf8')
  const { newDoc, diff } = await updateContext(
    { kind: target.kind, contextDoc, userInput: args.userInput, transcript: args.transcript, date: args.date, locale, agent },
    runAgent,
  )
  if (!newDoc) return { ok: false, reason: 'agent produced no usable update' }
  const msg = `context(${target.kind} ${target.key}): ${args.userInput?.trim() ? 'supplement' : 'refresh'}`
  docStore.writeDoc(target.abs, newDoc, { message: msg })
  const commit = headCommit(docStore.root)   // snapshot the doc-update commit BEFORE rotation may add more commits
  const cfg = args.getCfg()
  // Note: if rotation fires below it adds further commits; `commit` intentionally points at the doc update so
  // the revert affordance targets the user's change. Revert is best-effort if a rotation intervened.
  const rotated = rotateContextDocOnDisk(docStore, target.abs, { maxLines: cfg.logMaxLines, keep: cfg.logKeep, locale })
  return { ok: true, changed: diff.changed, added: diff.added, removed: diff.removed, commit, rotated }
}

/** Session wrapper: resolve the session's target, read its transcript, run the update. */
export async function runConsolidation(args: {
  session: SessionLite; task: TaskLite | null; docStore: DocStore; locale: Locale; agent: BerthAgent
  getCfg: () => { logMaxLines: number; logKeep: number }
}): Promise<ContextUpdateOutcome> {
  const target = resolveSessionContextTarget(args.session, args.task, args.docStore)
  if (!target) return { ok: false, reason: 'session not linked to a task or project' }
  const transcript = readTranscript(args.session.contentSourcePath)
  if (!transcript) return { ok: false, reason: 'no readable transcript' }
  const date = new Date().toISOString().slice(0, 10)
  return runContextUpdate({ target, docStore: args.docStore, locale: args.locale, agent: args.agent, transcript, date, getCfg: args.getCfg })
}
