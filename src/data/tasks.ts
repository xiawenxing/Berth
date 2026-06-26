import { randomUUID } from 'node:crypto'
import { generateTaskTitle } from '../agent/index'
import { classifyProject } from '../agent/triage'
import { listProjects, createProject } from './projects'
import { getTaskFieldConfig } from './task-config'
import { resolveBerthAgent } from './agent-config'
import { triggerTaskSummary } from './task-summary'
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
 *   4. pasted images → Berth docstore: write the task's detail md embedding them, set `detail_doc`.
 * External push is the sync engine's job (runs separately per push_mode).
 */
export async function createTask(
  store: Store,
  docStore: DocStore,
  text: string,
  opts: { projectId?: string; confirm?: boolean; createOption?: boolean; images?: string[]; autoTitle?: boolean } = {},
  now: Now = Date.now,
): Promise<CreateResult> {
  text = text.trim()
  if (!text) throw new Error('empty task text')

  // 1. search-before-create
  const dup = findDuplicate(store, text)
  if (dup && !opts.confirm) return { status: 'duplicate', existing: dup }

  const projects = listProjects(store)
  const names = projects.map(p => p.name)

  // 2. resolve target project
  let projectId: string | null = null
  let project: string | null = null
  if (opts.projectId) {
    const existing = projects.find(p => p.id === opts.projectId || p.name === opts.projectId)
    if (!existing) {
      if (!opts.createOption) return { status: 'needs-confirm', text, candidates: [], needNewProject: true, suggestedNewName: opts.projectId }
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
    const cls = await classifyProject(text, names, resolveBerthAgent(store))
    const top = cls.candidates[0]
    if (top && top.confidence >= CONFIDENCE_THRESHOLD && !cls.needNewProject &&
        (cls.candidates.length === 1 || top.confidence - cls.candidates[1].confidence >= 0.2)) {
      const p = projects.find(p => p.name === top.name)
      projectId = p?.id ?? null
      project = p?.name ?? top.name
    } else {
      return { status: 'needs-confirm', text, candidates: cls.candidates, needNewProject: cls.needNewProject, suggestedNewName: cls.suggestedNewName }
    }
  }

  let title = text
  if (opts.autoTitle) {
    try {
      const generated = (await generateTaskTitle(text, resolveBerthAgent(store))).trim()
      if (generated) title = generated
    } catch {
      // Title generation is best-effort; task creation should not fail just because the agent is blocked.
    }
    const titleDup = title !== text ? findDuplicate(store, title) : null
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

  // 4. pasted images → detail doc owned by Berth
  let detailDoc: string | undefined
  if (opts.images && opts.images.length) {
    try { detailDoc = attachImagesAsDetailDoc(store, docStore, id, title, project, opts.images, now) }
    catch { /* best-effort; the task already exists */ }
  }

  return { status: 'created', record: { id, title, projectId, project, detailDoc } }
}

/** Update a task's editable fields (title / priority / status). Validates enums; bumps updated_at. */
export function updateTask(store: Store, id: string, patch: { title?: string; priority?: string; status?: string; progress?: string }, now: Now = Date.now): { ok: true } {
  if (!id) throw new Error('id required')
  const cfg = getTaskFieldConfig(store)
  const fields: { title?: string; priority?: string; status?: string; progress?: string } = {}
  if (typeof patch.title === 'string' && patch.title.trim()) fields.title = patch.title.trim()
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

function attachImagesAsDetailDoc(store: Store, docStore: DocStore, id: string, title: string, project: string | null, images: string[], now: Now): string | undefined {
  const ref = docStore.taskDocRef(id)                 // tasks/<id>/index.md
  const destDir = ref.replace(/\/[^/]*$/, '')         // tasks/<id> — co-locate assets next to the note
  const saved = images.map(d => docStore.saveAttachment(d, 'task', destDir)).filter((s): s is { rel: string; abs: string } => !!s)
  if (!saved.length) return undefined
  const abs = docStore.resolveDocPath(ref)
  if (!abs) return undefined
  const md = `# ${title}\n\n- **项目领域**：${project ?? '（无）'}\n\n---\n\n## 附图\n\n${saved.map(s => `![](${s.rel})`).join('\n\n')}\n`
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
