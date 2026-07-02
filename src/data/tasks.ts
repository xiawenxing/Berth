import { randomUUID } from 'node:crypto'
import { generateTaskTitle } from '../agent/index'
import { classifyProject } from '../agent/triage'
import { listProjects, createProject } from './projects'
import { getTaskFieldConfig } from './task-config'
import { resolveBerthAgent } from './agent-config'
import { triggerTaskSummary } from './task-summary'
import { compactTitle, TASK_CREATE_INPUT_MAX_CHARS } from '../title-limits'
import type { DocStore } from './docstore'
import type { Task } from './types'

type Store = ReturnType<typeof import('../db/store').openStore>
type Now = () => number

const CONFIDENCE_THRESHOLD = 0.7

export type CreateResult =
  | { status: 'duplicate'; existing: { id: string; title: string } }
  | { status: 'created'; record: { id: string; title: string; projectId: string | null; project: string | null; detailDoc?: string } }
  | { status: 'needs-confirm'; text: string; candidates: { name: string; confidence: number }[]; needNewProject: boolean; suggestedNewName?: string }

export function listTasks(store: Store): Task[] {
  return store.allTasks()
}

/**
 * Create a task against the internal store, with the guardrails ported from the old bitable path:
 *   1. search-before-create (against the store now — fast) → `duplicate` unless `confirm`.
 *   2. project resolution — explicit `projectId` (never auto-create an option unless `createOption`),
 *      else AI `classifyProject` writing an existing project only when confidently the single winner.
 *   3. mint a Berth uuid + insert.
 *   4. original request + pasted images → Berth docstore detail md, set `detail_doc`.
 * External push is the sync engine's job (runs separately per push_mode).
 */
export async function createTask(
  store: Store,
  docStore: DocStore,
  text: string,
  opts: { projectId?: string; confirm?: boolean; createOption?: boolean; images?: string[]; autoTitle?: boolean } = {},
  now: Now = Date.now,
): Promise<CreateResult> {
  const originalText = text.trim()
  const images = opts.images ?? []
  if (!originalText && images.length === 0) throw new Error('empty task text')
  if (originalText.length > TASK_CREATE_INPUT_MAX_CHARS) throw new Error(`task text too long: max ${TASK_CREATE_INPUT_MAX_CHARS} chars`)

  // 1. search-before-create
  const dup = originalText ? findDuplicate(store, originalText) : null
  if (dup && !opts.confirm) return { status: 'duplicate', existing: dup }

  const projects = listProjects(store)
  const names = projects.map(p => p.name)

  // 2. resolve target project
  let projectId: string | null = null
  let project: string | null = null
  if (opts.projectId) {
    const existing = projects.find(p => p.id === opts.projectId || p.name === opts.projectId)
    if (!existing) {
      if (!opts.createOption) return { status: 'needs-confirm', text: originalText, candidates: [], needNewProject: true, suggestedNewName: opts.projectId }
      const created = createProject(store, opts.projectId)
      projectId = created.id
      project = created.name
    } else {
      projectId = existing.id
      project = existing.name
    }
  } else if (opts.confirm) {
    // confirm with no projectId → taskless write
  } else {
    const cls = await classifyProject(originalText, names, resolveBerthAgent(store))
    const top = cls.candidates[0]
    if (top && top.confidence >= CONFIDENCE_THRESHOLD && !cls.needNewProject &&
        (cls.candidates.length === 1 || top.confidence - cls.candidates[1].confidence >= 0.2)) {
      const p = projects.find(p => p.name === top.name)
      projectId = p?.id ?? null
      project = p?.name ?? top.name
    } else {
      return { status: 'needs-confirm', text: originalText, candidates: cls.candidates, needNewProject: cls.needNewProject, suggestedNewName: cls.suggestedNewName }
    }
  }

  let title = originalText ? compactTitle(originalText) : '图片任务'
  if (opts.autoTitle && originalText) {
    try {
      const generated = compactTitle(await generateTaskTitle(originalText, resolveBerthAgent(store)))
      if (generated) title = generated
    } catch {
      // Title generation is best-effort; task creation should not fail just because the agent is blocked.
    }
    const titleDup = title !== compactTitle(originalText) ? findDuplicate(store, title) : null
    if (titleDup && !opts.confirm) return { status: 'duplicate', existing: titleDup }
  }

  // 3. mint + insert
  const id = randomUUID()
  const t = now()
  const cfg = getTaskFieldConfig(store)
  const task: Task = {
    id, title, status: cfg.defaultStatus, priority: cfg.defaultPriority,
    projectId, project, detailDoc: null, progress: null, updatedAt: t, syncedAt: 0, deleted: false,
  }
  store.insertTask(task)

  // 4. Preserve the task creation payload as the durable execution context. The short title is only
  // a human index; task id + context doc carry the full semantics agents need when launched later.
  let detailDoc: string | undefined
  try { detailDoc = writeInitialTaskContextDoc(store, docStore, id, title, project, originalText, images, now) }
  catch { /* best-effort; the task already exists */ }

  return { status: 'created', record: { id, title, projectId, project, detailDoc } }
}

/** Update a task's editable fields (title / priority / status). Validates enums; bumps updated_at. */
export function updateTask(store: Store, id: string, patch: { title?: string; priority?: string; status?: string; progress?: string }, now: Now = Date.now): { ok: true } {
  if (!id) throw new Error('id required')
  const cfg = getTaskFieldConfig(store)
  const fields: { title?: string; priority?: string; status?: string; progress?: string } = {}
  if (typeof patch.title === 'string' && patch.title.trim()) fields.title = compactTitle(patch.title)
  if (typeof patch.priority === 'string') {
    if (!cfg.priorities.includes(patch.priority)) throw new Error(`invalid priority: ${patch.priority}`)
    fields.priority = patch.priority
  }
  if (typeof patch.status === 'string') {
    if (!cfg.statuses.includes(patch.status)) throw new Error(`invalid status: ${patch.status}`)
    fields.status = patch.status
  }
  if (typeof patch.progress === 'string') fields.progress = patch.progress   // free text; '' clears it
  if (Object.keys(fields).length === 0) throw new Error('no editable fields in patch')
  // Detect an actual status change (before the write) so we can auto-refresh the progress summary.
  const statusChanged = fields.status !== undefined && store.getTask(id)?.status !== fields.status
  store.updateTaskFields(id, fields, now())
  // Any local status change (UI / berth CLI / any PATCH path lands here) kicks a background summary
  // regeneration; fire-and-forget + per-task dedup, so it never blocks or stacks up. Sync-pulled
  // changes go through store.updateTaskFields directly and are intentionally NOT hooked here.
  if (statusChanged) triggerTaskSummary(store, id)
  return { ok: true }
}

/** Soft-delete a task (so the delete can propagate to external sources on sync). */
export function deleteTask(store: Store, id: string, now: Now = Date.now): { ok: true } {
  if (!id) throw new Error('id required')
  store.softDeleteTask(id, now())
  return { ok: true }
}

// ── helpers ────────────────────────────────────────────────────────────────────

function writeInitialTaskContextDoc(
  store: Store,
  docStore: DocStore,
  id: string,
  title: string,
  project: string | null,
  originalText: string,
  images: string[],
  now: Now,
): string | undefined {
  const ref = docStore.taskDocRef(id)                 // tasks/<id>/index.md
  const destDir = ref.replace(/\/[^/]*$/, '')         // tasks/<id> — co-locate assets next to the note
  const saved = images.map(d => docStore.saveAttachment(d, 'task', destDir)).filter((s): s is { rel: string; abs: string } => !!s)
  const abs = docStore.resolveDocPath(ref)
  if (!abs) return undefined
  const request = originalText || '（仅通过粘贴图片创建，见下方附图。）'
  const imageSection = saved.length ? `\n## 附图\n\n${saved.map((s, i) => `![任务附图 ${i + 1}](${s.rel})`).join('\n\n')}\n\n` : ''
  const md = [
    `# ${title} — 任务上下文`,
    '',
    '## Goal / Acceptance',
    '<!-- stable: do not change unless asked -->',
    '',
    request,
    '',
    '## Background',
    `<!-- stable: belongs to project ${project ?? '—'} -->`,
    '',
    '## Original request',
    '<!-- stable: verbatim user-provided creation details -->',
    '',
    request,
    '',
    imageSection.trimEnd(),
    '## Plan / TODO',
    '<!-- active: - [ ] checkboxes, tick when done -->',
    '',
    '## Decisions / Risks',
    '<!-- active -->',
    '',
    '## Progress log',
    '<!-- append-only: - YYYY-MM-DD: … -->',
    '',
  ].filter((line) => line !== '').join('\n') + '\n'
  docStore.writeDoc(abs, md)
  store.updateTaskFields(id, { detailDoc: ref }, now())
  return ref
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Find a non-deleted task whose title strongly matches (normalized exact or containment). */
function findDuplicate(store: Store, text: string): { id: string; title: string } | null {
  const want = normTitle(text)
  if (!want) return null
  for (const t of store.allTasks()) {
    const got = normTitle(t.title)
    if (got === want || got.includes(want) || want.includes(got)) return { id: t.id, title: t.title }
  }
  return null
}
