import { Router } from 'express'
import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { getStore, getCache, refresh, storeRoots } from './store-singleton'
import { collectLogicalSessions } from '../sessions'
import { canonicalPathKey } from '../path-normalize'
import { listProjects, createProject, updateProject, deleteProject } from '../data/projects'
import { listTasks, createTask, updateTask, deleteTask } from '../data/tasks'
import { getDocStore, getDocsRoot } from '../data/docstore'
import { getTaskFieldConfig, setTaskFieldConfig } from '../data/task-config'
import { getAgentConfig, setAgentConfig, resolveBerthAgent } from '../data/agent-config'
import { getLocale, normalizeLocale, LOCALES, contextStrings } from '../i18n'
import { ensureContextDoc, appendContextLogOnDisk } from '../data/context-doc'
import { getContextConfig, setContextConfig } from '../data/context-config'
import { lastLogEntries } from '../data/context-log'
import { syncSource, resolveConflict } from '../data/sync/engine'
import { adapterCapabilities, getAdapter } from '../data/sync/registry'
import type { DataSourceRow, SyncMode } from '../data/types'
import { generateTitle, generateProgressSummary } from '../agent/index'
import { isInternalAgentBlocked, agentBlockHint } from '../agent/agent-failure'
import { titleInputFromTranscript } from '../agent/transcript'
import type { Locale } from '../i18n'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { snapshotActivity } from './pty-registry'
import { runConsolidation, runContextUpdate, readTranscript, type ContextTarget } from './context-consolidate-service'
import { parseTranscriptTurns } from './transcript-turns'
import { revertCommit } from '../data/doc-git'
import { berthAgentCwd, berthHome } from '../paths'

function isFolderPickerCancelled(err: unknown, stderr = ''): boolean {
  const e = err as { message?: unknown; stderr?: unknown }
  const text = `${String(e?.message ?? '')}\n${String(e?.stderr ?? '')}\n${stderr}`
  return /User canceled/i.test(text) || /\(-128\)/.test(text)
}

function truncate(s: string | null, max: number): string | null {
  if (!s) return null
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function contextAgentError(error: unknown) {
  return { error: String((error as any)?.message ?? error), contextAgentCwd: berthAgentCwd() }
}

/**
 * Map an internal-agent failure to a response. A typed `InternalAgentBlocked` (auth/timeout/other)
 * becomes a 409 with a structured, actionable body the UI renders directly; everything else keeps the
 * previous generic 502. `res` is returned for `return sendAgentError(...)` call sites.
 */
function sendAgentError(res: import('express').Response, error: unknown, locale: Locale) {
  if (isInternalAgentBlocked(error)) {
    return res.status(409).json({
      blocked: error.kind, cli: error.cli, hint: agentBlockHint(error.kind, error.cli, locale),
      ...contextAgentError(error),
    })
  }
  return res.status(502).json(contextAgentError(error))
}

function readTitleTranscriptSample(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const maxBytes = 1024 * 1024
    if (size <= maxBytes) {
      const b = Buffer.alloc(size)
      const n = readSync(fd, b, 0, size, 0)
      return b.toString('utf8', 0, n)
    }

    const headBytes = 256 * 1024
    const tailBytes = maxBytes - headBytes
    const head = Buffer.alloc(headBytes)
    const hn = readSync(fd, head, 0, headBytes, 0)
    const tailStart = Math.max(0, size - tailBytes)
    const tail = Buffer.alloc(size - tailStart)
    const tn = readSync(fd, tail, 0, tail.length, tailStart)
    let tailText = tail.toString('utf8', 0, tn)
    const firstNewline = tailText.indexOf('\n')
    if (tailStart > 0 && firstNewline >= 0) tailText = tailText.slice(firstNewline + 1)
    return head.toString('utf8', 0, hn) + '\n' + tailText
  } finally {
    closeSync(fd)
  }
}

export interface ApiSession {
  sessionId: string; cli: string; cwd: string | null; title: string | null
  updatedAt: number; deleted: boolean; copies: number
  pinned: boolean; projectId: string | null; project: string | null; attachState: string
  todoKey?: string | null
  activity: 'running' | 'settled' | null   // live PTY status (null = no live process / external session)
}

function serialize(): ApiSession[] {
  const store = getStore()
  const pins = store.allPinnedSet()
  const attach = store.allAttachMap()
  const projectRows = typeof (store as any).allProjects === 'function' ? store.allProjects() : []
  const projectNames = new Map(projectRows.map(p => [p.id, p.name]))
  const overrides = store.allTitleOverrides()
  // Build a single sessionId→todoKey reverse map from edgesByTodo() ONCE (outside the .map)
  const edgesMap = store.edgesByTodo()
  const reverseMap = new Map<string, string>()
  for (const [todoKey, sessionIds] of edgesMap) {
    for (const sid of sessionIds) reverseMap.set(sid, todoKey)
  }
  // Live activity snapshot from the pty-registry (built once; O(1) lookup per session).
  const activityMap = new Map(snapshotActivity().map(a => [a.sessionId, a.state]))
  return getCache().map(s => ({
    sessionId: s.sessionId, cli: s.cli, cwd: s.cwd, title: overrides.get(s.sessionId) ?? s.title,
    updatedAt: s.updatedAt, deleted: s.deleted, copies: s.copies.length,
    pinned: pins.has(s.sessionId),
    projectId: attach.get(s.sessionId)?.projectId ?? null,
    project: projectNames.get(attach.get(s.sessionId)?.projectId ?? '') ?? null,
    attachState: attach.get(s.sessionId)?.state ?? 'unconfirmed',
    todoKey: reverseMap.get(s.sessionId) ?? null,
    activity: activityMap.get(s.sessionId) ?? null,
  })).sort((a, b) => b.updatedAt - a.updatedAt)
}

export const api = Router()
api.get('/sessions', (_req, res) => res.json(serialize()))
api.post('/refresh', (_req, res) => { refresh(); res.json({ ok: true, count: getCache().length }) })

api.post('/pin', (req, res) => {
  const { sessionId, on } = req.body ?? {}
  if (typeof sessionId !== 'string' || typeof on !== 'boolean')
    return res.status(400).json({ error: 'sessionId:string, on:boolean required' })
  getStore().setPin(sessionId, on)
  res.json({ ok: true })
})

api.post('/attach', (req, res) => {
  const { sessionId, projectId, state } = req.body ?? {}
  if (typeof sessionId !== 'string')
    return res.status(400).json({ error: 'sessionId required' })
  // projectId may be null (detach); state defaults to 'confirmed' on a manual assign
  getStore().setAttach(sessionId, projectId ?? null, typeof state === 'string' ? state : 'confirmed')
  res.json({ ok: true })
})

// Assign an EXISTING session to a task (edge), or detach it (todoKey null/empty).
// A session belongs to at most one task via this control: prior edges are cleared first.
// Optional projectId co-confirms the session under that project (so it shows in the workspace).
api.post('/edge', (req, res) => {
  const { sessionId, todoKey, projectId } = req.body ?? {}
  if (typeof sessionId !== 'string' || sessionId === '')
    return res.status(400).json({ error: 'sessionId required' })
  const store = getStore()
  store.removeEdgesForSession(sessionId)
  if (typeof todoKey === 'string' && todoKey !== '') store.addEdge(todoKey, sessionId)
  if (typeof projectId === 'string' && projectId !== '') store.setAttach(sessionId, projectId, 'confirmed')
  res.json({ ok: true })
})

// Native macOS folder picker (the browser can't expose absolute paths). Returns the chosen
// absolute path, or { cancelled: true } if the user cancels / no GUI is available.
api.post('/pick-folder', (req, res) => {
  const def = typeof req.body?.default === 'string' ? req.body.default : ''
  // `choose folder` returns an alias; `POSIX path of` yields the absolute path (trailing slash).
  const loc = def ? ` default location (POSIX file ${JSON.stringify(def)})` : ''
  const cancelled = () => res.json({ cancelled: true })
  const tryScript = (script: string, onFail: () => void) => {
    execFile('osascript', ['-e', script], { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        if (isFolderPickerCancelled(err, stderr?.toString?.() ?? '')) return cancelled()
        return onFail()
      }
      const p = stdout.toString().trim().replace(/\/+$/, '')
      if (!p) return onFail()
      res.json({ path: p })
    })
  }
  // Try with the default location first; if that errors (e.g. path gone), retry without it.
  tryScript(
    `POSIX path of (choose folder with prompt "选择会话工作目录"${loc})`,
    () => tryScript(
      `POSIX path of (choose folder with prompt "选择会话工作目录")`,
      cancelled,
    ),
  )
})

api.get('/projects', (_req, res) => {
  const store = getStore()
  const archived = store.allArchivedSet()
  const pathMap = store.allProjectPaths()
  res.json({
    error: null,
    projects: listProjects(store).map(p => ({
      ...p,
      archived: archived.has(p.id),
      homeCwd: pathMap.get(p.id)?.home ?? null,
      paths: pathMap.get(p.id)?.paths ?? [],          // bare string[] — back-compat (old app + ApiProject)
      pathsMeta: pathMap.get(p.id)?.meta ?? [],        // {cwd,enabled}[] — drives the 货舱 toggle UI
      workspaceCwd: join(berthHome(), 'workspaces', p.id), // Berth-assigned default cwd (masked in UI)
      lastCwd: store.getSetting(`project_last_cwd:${p.id}`), // sticky 主 cwd for the launch auto-pick
    })),
  })
})

// Project 小结: summarize the project's context doc into a short progress blurb (港务助手).
// Return the last cached 项目小结 (if any) without regenerating — drives the popover's first open.
api.get('/projects/:id/summary', (req, res) => {
  const store = getStore()
  const project = listProjects(store).find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'unknown project' })
  const cached = store.getProjectSummary(project.id)
  res.json(cached ? { summary: cached.summary, generatedAt: cached.generatedAt } : { summary: null })
})

// Mirrors /todos/:id/progress-summary but over the project context doc (keyed by project name).
// Persists the result so reopening the popover (or reloading) shows it without regenerating.
api.post('/projects/:id/summary', async (req, res) => {
  const store = getStore()
  const project = listProjects(store).find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'unknown project' })
  const ds = getDocStore(store)
  const locale = getLocale(store)
  try {
    const ensured = ensureContextDoc(ds, 'project', project.name, { title: project.name, projectName: project.name, locale })
    const { content } = ds.readDoc(ensured.abs)
    const summary = await generateProgressSummary(content, contextStrings(locale).summaryPrompt, resolveBerthAgent(store))
    if (!summary) return res.status(502).json({ error: 'agent returned empty summary' })
    const generatedAt = Date.now()
    store.setProjectSummary(project.id, summary, generatedAt)
    res.json({ summary, generatedAt })
  } catch (e: any) {
    sendAgentError(res, e, locale)
  }
})

api.post('/projects/archive', (req, res) => {
  const { projectId, name, on } = req.body ?? {}
  const store = getStore()
  const id = typeof projectId === 'string' ? projectId : (typeof name === 'string' ? store.resolveProjectId(name) : null)
  if (!id || typeof on !== 'boolean')
    return res.status(400).json({ error: 'projectId:string, on:boolean required' })
  store.setArchived(id, on)
  res.json({ ok: true })
})

api.patch('/projects/:id', (req, res) => {
  const { name, hue } = req.body ?? {}
  const patch: { name?: string; hue?: string | null } = {}
  if (name !== undefined) patch.name = name
  if (hue !== undefined) patch.hue = hue
  if (!Object.keys(patch).length)
    return res.status(400).json({ error: 'name or hue required' })
  try {
    const project = updateProject(getStore(), req.params.id, patch)
    res.json({ ok: true, project })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

api.delete('/projects/:id', (req, res) => {
  try {
    deleteProject(getStore(), req.params.id)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// Create a project in the internal store + record its home cwd locally. (External sources pick up
// the new project on the next sync; pushing a task under it ensures its option exists then.)
api.post('/projects/create', (req, res) => {
  const { name, cwd, hue } = req.body ?? {}
  if (typeof name !== 'string' || name.trim() === '')
    return res.status(400).json({ error: 'name required' })
  try {
    const store = getStore()
    const project = createProject(store, name.trim(), typeof hue === 'string' ? hue : undefined)
    if (typeof cwd === 'string' && cwd.trim() !== '') store.addProjectPath(project.id, cwd.trim(), true)
    res.json({ ok: true, id: project.id, name: project.name })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// ── Session import directories (the 无归属 import roots) ──
// The session list is seeded by importing directories, not by scanning every CLI session. Adding or
// removing a directory re-scans so the change is reflected immediately.
api.get('/session-dirs', (_req, res) => res.json({ dirs: getStore().allSessionImportDirs() }))

api.post('/session-dirs', (req, res) => {
  const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim().replace(/\/+$/, '') : ''
  if (!cwd) return res.status(400).json({ error: 'cwd required' })
  getStore().addSessionImportDir(cwd)
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// Preview which CLI sessions a candidate import dir would surface, WITHOUT mutating state (no import,
// no refresh). Scans the same CLI stores `refresh()` reads and returns sessions whose cwd EQUALS the
// given cwd — the exact-match rule `filterImportedSessions` applies to import roots. Returns the FULL
// set (no cap): the import dialog paginates client-side (近期 8 + Show more) and 全选 must cover all.
function normDirForMatch(p: string): string {
  const key = canonicalPathKey(p)
  return key.length > 1 ? key.replace(/\/+$/, '') : key
}
api.post('/session-dirs/preview', (req, res) => {
  const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim().replace(/\/+$/, '') : ''
  if (!cwd) return res.status(400).json({ error: 'cwd required' })
  const target = normDirForMatch(cwd)
  const all = collectLogicalSessions(storeRoots())
  const sessions = all
    .filter(s => s.cwd != null && normDirForMatch(s.cwd) === target)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(s => ({
      sessionId: s.sessionId,
      cli: s.cli,
      title: s.title ?? null,
      cwd: s.cwd ?? null,
      updatedAt: s.updatedAt,
    }))
  res.json({ sessions })
})

api.delete('/session-dirs', (req, res) => {
  const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim().replace(/\/+$/, '') : ''
  if (!cwd) return res.status(400).json({ error: 'cwd required' })
  getStore().removeSessionImportDir(cwd)
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// Register a cwd as a project 货舱 (optionally home, optionally disabled). `enabled` defaults true.
api.post('/projects/add-path', (req, res) => {
  const { projectId, name, cwd, isHome, enabled } = req.body ?? {}
  const store = getStore()
  const id = typeof projectId === 'string' ? projectId : (typeof name === 'string' ? store.resolveProjectId(name) : null)
  if (!id || typeof cwd !== 'string' || cwd.trim() === '')
    return res.status(400).json({ error: 'projectId:string, cwd:string required' })
  store.addProjectPath(id, cwd.trim(), !!isHome, enabled === undefined ? true : !!enabled)
  res.json({ ok: true })
})

// Toggle a registered path's 默认装载 (enabled) flag.
api.post('/projects/path/toggle', (req, res) => {
  const { projectId, name, cwd, enabled } = req.body ?? {}
  const store = getStore()
  const id = typeof projectId === 'string' ? projectId : (typeof name === 'string' ? store.resolveProjectId(name) : null)
  if (!id || typeof cwd !== 'string' || cwd.trim() === '' || typeof enabled !== 'boolean')
    return res.status(400).json({ error: 'projectId:string, cwd:string, enabled:boolean required' })
  store.setPathEnabled(id, cwd.trim(), enabled)
  res.json({ ok: true })
})

// Remove a registered 货舱 path (does not touch any already-imported sessions). POST (not DELETE)
// with a two-segment path so it can't be shadowed by `DELETE /projects/:id` (:id="path").
api.post('/projects/path/remove', (req, res) => {
  const { projectId, name, cwd } = req.body ?? {}
  const store = getStore()
  const id = typeof projectId === 'string' ? projectId : (typeof name === 'string' ? store.resolveProjectId(name) : null)
  if (!id || typeof cwd !== 'string' || cwd.trim() === '')
    return res.status(400).json({ error: 'projectId:string, cwd:string required' })
  store.removeProjectPath(id, cwd.trim())
  res.json({ ok: true })
})

// Session-grained import: mark the given sessions as explicitly in Berth's visible set (and, with a
// projectId, attach them to that project). Replaces the old dir-grained importDir for the React app —
// registering a 货舱 cwd no longer surfaces all its sessions; only these ids surface.
api.post('/session-import', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  const projectId = typeof req.body?.projectId === 'string' && req.body.projectId.trim() !== '' ? req.body.projectId.trim() : null
  const store = getStore()
  for (const id of ids) {
    store.addSessionImport(id)
    if (projectId) store.setAttach(id, projectId, 'confirmed')
  }
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// 移出项目（保留导入信号）：批量 detach。会话脱离项目、回到「无归属」（若仍在 session_import）。
api.post('/sessions/detach', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) store.setAttach(id, null, 'confirmed')
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// 取消导入：撤销会话粒度导入信号并 detach。除非 cwd 仍匹配某导入目录根或被 pin/edge，否则从列表消失。
api.post('/session-import/remove', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) { store.removeSessionImport(id); store.setAttach(id, null, 'confirmed') }
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// ── Markdown context docs (read/write, restricted to the configurable docs root) ──
api.get('/doc', (req, res) => {
  const ds = getDocStore(getStore())
  const abs = ds.resolveDocPath(String(req.query.path ?? ''))
  if (!abs) return res.status(400).json({ error: 'invalid or out-of-docstore path' })
  try {
    const { content, mtime } = ds.readDoc(abs)
    res.json({ path: abs, content, mtime })
  } catch (e: any) {
    res.status(404).json({ error: 'not found: ' + String(e?.message ?? e) })
  }
})

// Serve an image/asset that lives under the docs root (for md preview embeds).
const ASSET_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
api.get('/doc-asset', (req, res) => {
  const abs = getDocStore(getStore()).resolveAssetPath(String(req.query.path ?? ''))
  if (!abs) return res.status(400).end()
  try {
    res.setHeader('Content-Type', ASSET_TYPE[abs.split('.').pop()!.toLowerCase()] || 'application/octet-stream')
    res.end(readFileSync(abs))
  } catch { res.status(404).end() }
})

api.post('/doc', (req, res) => {
  const { path: ref, content, baseMtime } = req.body ?? {}
  if (typeof ref !== 'string' || typeof content !== 'string')
    return res.status(400).json({ error: 'path:string, content:string required' })
  const ds = getDocStore(getStore())
  const abs = ds.resolveDocPath(ref)
  if (!abs) return res.status(400).json({ error: 'invalid or out-of-docstore path' })
  // Conflict guard: refuse if the file changed on disk (e.g. edited externally) since load.
  if (typeof baseMtime === 'number') {
    const cur = ds.docMtime(abs)
    if (cur !== null && cur !== baseMtime) return res.status(409).json({ conflict: true, mtime: cur })
  }
  try {
    const { mtime } = ds.writeDoc(abs, content)
    res.json({ ok: true, mtime })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) })
  }
})

// Revert a single doc-store commit (the "回滚此次" affordance after an agent update).
api.post('/doc/revert', (req, res) => {
  const { commit } = req.body ?? {}
  if (typeof commit !== 'string' || !/^[0-9a-fA-F]{7,40}$/.test(commit))
    return res.status(400).json({ error: 'commit sha required' })
  const r = revertCommit(getDocStore(getStore()).root, commit)
  if (!r.ok) return res.status(409).json({ error: r.reason })
  res.json({ ok: true })
})

// Ensure (lazily create) the context file for a task/project. Idempotent — never overwrites.
api.post('/context', (req, res) => {
  const { kind, key, title } = req.body ?? {}
  if ((kind !== 'task' && kind !== 'project') || typeof key !== 'string' || !key.trim())
    return res.status(400).json({ error: 'kind:task|project, key:string required' })
  const store = getStore()
  const ds = getDocStore(store)
  const locale = getLocale(store)
  try {
    const task = kind === 'task' ? listTasks(store).find(t => t.id === key) : undefined
    const projectName = kind === 'project' ? key : (task?.project ?? null)
    const ensured = ensureContextDoc(ds, kind, key, { title: typeof title === 'string' && title.trim() ? title : key, projectName, locale })
    if (kind === 'task' && ensured.created && task && !task.detailDoc) {
      store.updateTaskFields(key, { detailDoc: ensured.ref }, Date.now())
    }
    res.json({ ref: ensured.ref, created: ensured.created })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) })
  }
})

// Mechanically append a dated entry to an entity's progress-log section (canonical B).
api.post('/context/log', (req, res) => {
  const { kind, key, text } = req.body ?? {}
  if ((kind !== 'task' && kind !== 'project') || typeof key !== 'string' || !key.trim())
    return res.status(400).json({ error: 'kind:task|project, key:string required' })
  if (typeof text !== 'string' || !text.trim())
    return res.status(400).json({ error: 'text required' })
  const store = getStore()
  const ds = getDocStore(store)
  const locale = getLocale(store)
  const cfg = getContextConfig(store)
  try {
    const task = kind === 'task' ? listTasks(store).find(t => t.id === key) : undefined
    const projectName = kind === 'project' ? key : (task?.project ?? null)
    const ensured = ensureContextDoc(ds, kind, key, { title: task?.title ?? key, projectName, locale })
    if (kind === 'task' && ensured.created && task && !task.detailDoc) {
      store.updateTaskFields(key, { detailDoc: ensured.ref }, Date.now())
    }
    const date = new Date().toISOString().slice(0, 10)
    // appendLogEntry collapses internal whitespace/newlines into a single line — no pre-processing needed here.
    const r = appendContextLogOnDisk(ds, ensured.abs, { text, date, maxLines: cfg.logMaxLines, keep: cfg.logKeep, locale })
    res.json({ ref: ensured.ref, appended: r.appended, rotated: r.rotated })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) })
  }
})

// Agent-driven context update: fold user-supplied info (and/or a session transcript) into the
// entity's context file. Any section may change; the write is git-committed (revertable).
api.post('/context/update', async (req, res) => {
  const { kind, key, userInput, sessionId, images } = req.body ?? {}
  const imgs = Array.isArray(images) ? images.filter((s: any) => typeof s === 'string') : []
  if ((kind !== 'task' && kind !== 'project') || typeof key !== 'string' || !key.trim())
    return res.status(400).json({ error: 'kind:task|project, key:string required' })
  if ((typeof userInput !== 'string' || !userInput.trim()) && typeof sessionId !== 'string' && imgs.length === 0)
    return res.status(400).json({ error: 'userInput, images, or sessionId required' })
  const store = getStore(); const ds = getDocStore(store); const locale = getLocale(store)
  try {
    const task = kind === 'task' ? (listTasks(store).find(t => t.id === key) ?? null) : null
    const projectName = kind === 'project' ? key : (task?.project ?? null)
    const ref = kind === 'task' ? ds.taskDocRef(key) : ds.projectDocRef(key)
    const abs = ds.resolveDocPath(ref)
    if (!abs) return res.status(400).json({ error: 'cannot resolve context path' })
    const target: ContextTarget = { kind, key, title: task?.title ?? key, projectName, ref, abs }
    const savedImages = imgs
      .map((d: string) => ds.saveAttachment(d, 'context', dirname(ref)))
      .filter((s): s is { rel: string; abs: string } => !!s)
    const imageInput = savedImages.length
      ? `Pasted images:\n${savedImages.map(s => `![](${s.rel})`).join('\n')}`
      : ''
    const effectiveUserInput = [typeof userInput === 'string' ? userInput.trim() : '', imageInput].filter(Boolean).join('\n\n')
    let transcript: string | undefined
    if (typeof sessionId === 'string') {
      const s = getCache().find(x => x.sessionId === sessionId)
      transcript = s ? readTranscript(s.contentSourcePath) : undefined
    }
    const outcome = await runContextUpdate({
      target, docStore: ds, locale, agent: resolveBerthAgent(store),
      userInput: effectiveUserInput || undefined, transcript,
      date: new Date().toISOString().slice(0, 10),
      getCfg: () => { const c = getContextConfig(store); return { logMaxLines: c.logMaxLines, logKeep: c.logKeep } },
    })
    if (!outcome.ok) {
      try { refresh() } catch {}
      return res.status(409).json(contextAgentError(outcome.reason))
    }
    res.json({ ok: true, ref, changed: outcome.changed, added: outcome.added, removed: outcome.removed, commit: outcome.commit, rotated: outcome.rotated })
  } catch (e: any) {
    try { refresh() } catch {}
    res.status(502).json(contextAgentError(e))
  }
})

api.get('/todos', (_req, res) => {
  const store = getStore()
  const edgesMap = store.edgesByTodo()
  const ddlMap = store.allTaskDdls()
  const todos = listTasks(store).map(t => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId, project: t.project,
    detailDoc: t.detailDoc, progress: truncate(t.progress, 300),
    ddl: ddlMap.get(t.id) ?? null,
    sessions: edgesMap.get(t.id) ?? [],
  }))
  res.json({ error: null, todos })
})

// Progress for one task: the A snapshot + the last few B-log entries (UI lazy-loads this on expand).
api.get('/todos/:id/progress', (req, res) => {
  const store = getStore()
  const task = listTasks(store).find(t => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'unknown task' })
  const ds = getDocStore(store)
  const ref = task.detailDoc ?? ds.taskDocRef(task.id)
  const abs = ds.resolveDocPath(ref)
  let logTail: { date: string | null; text: string }[] = []
  if (abs) {
    try {
      const { content } = ds.readDoc(abs)
      logTail = lastLogEntries(content, contextStrings(getLocale(store)).logHeading, 3)
    } catch { /* doc not created yet */ }
  }
  res.json({ summary: task.progress, logTail })
})

api.post('/todos', async (req, res) => {
  const { text, projectId, confirm, createOption, images } = req.body ?? {}
  if (typeof text !== 'string' || (text.trim() === '' && (!Array.isArray(images) || images.length === 0)))
    return res.status(400).json({ error: 'text or images required' })
  try {
    const store = getStore()
    const imgs = Array.isArray(images) ? images.filter((s: any) => typeof s === 'string') : undefined
    const result = await createTask(store, getDocStore(store), text, { projectId, confirm, createOption, images: imgs })
    res.json(result)
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// Edit a task's title / priority / status / progress, and/or its local-only ddl (deadline).
api.patch('/todos/:id', (req, res) => {
  const { title, priority, status, progress, ddl } = req.body ?? {}
  // ddl is a local overlay (not a TaskField): null clears, 'YYYY-MM-DD' sets, undefined leaves alone.
  if (ddl !== undefined && ddl !== null && !/^\d{4}-\d{2}-\d{2}$/.test(ddl))
    return res.status(400).json({ error: 'ddl must be null or YYYY-MM-DD' })
  try {
    const store = getStore()
    // updateTask throws on an empty patch, so only call it when a TaskField is actually present —
    // a ddl-only patch must not trip that.
    if (title !== undefined || priority !== undefined || status !== undefined || progress !== undefined)
      updateTask(store, req.params.id, { title, priority, status, progress })
    if (ddl !== undefined) store.setTaskDdl(req.params.id, ddl)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// Summarize the task's context doc (B) into the short progress snapshot (A). Mirrors the title pipeline.
api.post('/todos/:id/progress-summary', async (req, res) => {
  const store = getStore()
  const task = listTasks(store).find(t => t.id === req.params.id)
  if (!task) return res.status(404).json({ error: 'unknown task' })
  const ds = getDocStore(store)
  const locale = getLocale(store)
  try {
    const ensured = ensureContextDoc(ds, 'task', task.id, { title: task.title, projectName: task.project, locale })
    if (ensured.created && !task.detailDoc) store.updateTaskFields(task.id, { detailDoc: ensured.ref }, Date.now())
    const { content } = ds.readDoc(ensured.abs)
    const summary = await generateProgressSummary(content, contextStrings(locale).summaryPrompt, resolveBerthAgent(store))
    if (!summary) return res.status(502).json({ error: 'agent returned empty summary' })
    updateTask(store, task.id, { progress: summary })
    res.json({ summary })
  } catch (e: any) {
    sendAgentError(res, e, locale)
  }
})

// Delete a task (soft delete; the removal propagates to external sources on the next sync).
api.delete('/todos/:id', (req, res) => {
  try {
    deleteTask(getStore(), req.params.id)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// ── Sync (manual by default): push local edits + pull external changes; surfaces conflicts ──
api.post('/sync', async (req, res) => {
  const store = getStore()
  const ctx = { docsRoot: getDocsRoot(store) }
  const only = typeof req.query.source === 'string' ? req.query.source : null
  // direction=pull → pull-only; direction=push → push-only; omitted → both (push + pull).
  const direction = typeof req.query.direction === 'string' ? req.query.direction : null
  const opts = direction === 'pull' ? { push: false } : direction === 'push' ? { pull: false } : {}
  const sources = (only ? [store.getDataSource(only)].filter(Boolean) as DataSourceRow[] : store.allDataSources())
    .filter(s => s.enabled)
  let pulled = 0, pushed = 0
  try {
    for (const s of sources) { const r = await syncSource(store, s, ctx, opts); pulled += r.pulled; pushed += r.pushed }
    res.json({ ok: true, pulled, pushed, conflicts: store.openConflicts() })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e), conflicts: store.openConflicts() })
  }
})

api.get('/conflicts', (_req, res) => res.json({ conflicts: getStore().openConflicts() }))

api.post('/conflicts/:id/resolve', async (req, res) => {
  const side = req.body?.side
  if (side !== 'berth' && side !== 'external') return res.status(400).json({ error: "side must be 'berth' or 'external'" })
  const store = getStore()
  try {
    await resolveConflict(store, req.params.id, side, { docsRoot: getDocsRoot(store) })
    res.json({ ok: true, conflicts: store.openConflicts() })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// ── Adapter capabilities: which optional integrations are usable on THIS machine. The UI uses this
//    to hide/disable integrations whose host tooling (e.g. Feishu → lark-cli) isn't installed, so the
//    core works for anyone without that tooling. ──
api.get('/capabilities', async (_req, res) => {
  try {
    res.json({ adapters: await adapterCapabilities() })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e), adapters: {} })
  }
})

// ── Data sources (external integrations) — all connection config lives here, not in code ──
api.get('/data-sources', (_req, res) => res.json({ sources: getStore().allDataSources() }))

api.post('/data-sources', (req, res) => {
  const b = req.body ?? {}
  if (typeof b.id !== 'string' || !b.id.trim() || typeof b.kind !== 'string' || !b.kind.trim())
    return res.status(400).json({ error: 'id and kind required' })
  const row: DataSourceRow = {
    id: b.id.trim(), kind: b.kind.trim(), label: typeof b.label === 'string' ? b.label : null,
    config: b.config ?? {},
    pullMode: (b.pullMode === 'auto' ? 'auto' : 'manual') as SyncMode,
    pushMode: (b.pushMode === 'auto' ? 'auto' : 'manual') as SyncMode,
    enabled: b.enabled !== false,
  }
  getStore().upsertDataSource(row)
  res.json({ ok: true })
})

// Paste-to-connect: the user picks a kind + pastes a URL; the adapter parses it and introspects the
// remote schema to build the (hidden) config. We then save a ready-to-use source. No hand-editing.
api.post('/data-sources/connect', async (req, res) => {
  const { kind, url } = req.body ?? {}
  if (typeof kind !== 'string' || !kind.trim()) return res.status(400).json({ error: 'kind required' })
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: '请粘贴数据源地址。' })
  let adapter
  try { adapter = getAdapter(kind.trim()) } catch { return res.status(400).json({ error: `不支持的数据源类型：${kind}` }) }
  if (!adapter.connectFromUrl) return res.status(400).json({ error: '该数据源类型暂不支持粘贴地址连接。' })
  const avail = adapter.checkAvailable ? await adapter.checkAvailable() : { available: true }
  if (!avail.available) return res.status(400).json({ error: avail.reason || '该数据源在本机不可用（缺少所需工具）。' })
  try {
    const store = getStore()
    const result = await adapter.connectFromUrl(url.trim(), { docsRoot: getDocsRoot(store) })
    store.upsertDataSource({
      id: result.id, kind: kind.trim(), label: result.label, config: result.config,
      pullMode: 'manual', pushMode: 'manual', enabled: true,
    })
    res.json({ ok: true, id: result.id, label: result.label })
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) })
  }
})

api.delete('/data-sources/:id', (req, res) => {
  getStore().deleteDataSource(req.params.id)
  res.json({ ok: true })
})

// ── App settings (docsRoot, locale, task status/priority vocabularies, …) ──
api.get('/settings', (_req, res) => {
  const store = getStore()
  res.json({ docsRoot: getDocsRoot(store), locale: getLocale(store), locales: LOCALES, ...getTaskFieldConfig(store), agents: getAgentConfig(store), context: getContextConfig(store) })
})

api.post('/settings', (req, res) => {
  const { docsRoot, locale, statuses, priorities, agents, context } = req.body ?? {}
  const store = getStore()
  if (typeof docsRoot === 'string' && docsRoot.trim()) store.setSetting('docsRoot', docsRoot.trim())
  if (typeof locale === 'string') store.setSetting('locale', normalizeLocale(locale))
  try {
    if (statuses !== undefined || priorities !== undefined) setTaskFieldConfig(store, { statuses, priorities })
    if (agents !== undefined) setAgentConfig(store, agents)
    if (context !== undefined) setContextConfig(store, context)
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'invalid settings' })
  }
  res.json({ ok: true, docsRoot: getDocsRoot(store), locale: getLocale(store), ...getTaskFieldConfig(store), agents: getAgentConfig(store), context: getContextConfig(store) })
})

api.post('/sessions/:id/title', async (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s || !s.contentSourcePath) return res.status(404).json({ error: 'no readable transcript' })
  let sample = ''
  try { sample = readTitleTranscriptSample(s.contentSourcePath) } catch {}
  const gist = titleInputFromTranscript(sample)
  if (!gist) return res.status(422).json({ error: 'no usable session content for title' })
  try {
    const title = await generateTitle(gist, resolveBerthAgent(getStore()))
    if (!title) return res.status(502).json({ error: 'agent returned empty title' })
    getStore().setTitleOverride(s.sessionId, title)
    res.json({ title })
  } catch (e: any) { sendAgentError(res, e, getLocale(getStore())) }
})

api.patch('/sessions/:id/title', (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s) return res.status(404).json({ error: 'unknown session' })
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title) return res.status(400).json({ error: 'title required' })
  getStore().setTitleOverride(s.sessionId, title)
  res.json({ title })
})

api.post('/sessions/:id/consolidate', async (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s) return res.status(404).json({ error: 'unknown session' })
  const store = getStore()
  const docStore = getDocStore(store)
  const locale = getLocale(store)
  // Resolve todoKey from edgesByTodo() reverse-lookup (as serialize() does) — the raw cache session
  // does not carry it.
  let todoKey: string | null = null
  for (const [tk, sids] of store.edgesByTodo()) {
    for (const sid of sids) { if (sid === s.sessionId) { todoKey = tk; break } }
    if (todoKey) break
  }
  // Resolve projectId from allAttachMap() (same pattern as serialize()).
  const projectId = store.allAttachMap().get(s.sessionId)?.projectId ?? null
  const task = todoKey ? (listTasks(store).find(t => t.id === todoKey) ?? null) : null
  try {
    const outcome = await runConsolidation({
      session: { sessionId: s.sessionId, todoKey, projectId, contentSourcePath: s.contentSourcePath },
      task: task ? { title: task.title, project: task.project } : null,
      docStore, locale, agent: resolveBerthAgent(store),
      getCfg: () => { const c = getContextConfig(store); return { logMaxLines: c.logMaxLines, logKeep: c.logKeep } },
    })
    if (!outcome.ok) {
      try { refresh() } catch {}
      return res.status(409).json(contextAgentError(outcome.reason))
    }
    res.json({ ok: true, changed: outcome.changed, added: outcome.added, removed: outcome.removed, commit: outcome.commit, rotated: outcome.rotated })
  } catch (e: any) {
    try { refresh() } catch {}
    sendAgentError(res, e, locale)
  }
})

// Structured conversation for the session drawer's codex-style chat view (walkthrough #4).
// Best-effort parse of the session jsonl into { turns: [{role:'user'|'agent'|'tool', text, collapsed?}] };
// falls back to a single cleaned agent turn for an unrecognized shape so it never crashes.
api.get('/sessions/:id/transcript', (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s || !s.contentSourcePath) return res.status(404).json({ error: 'no readable transcript' })
  try {
    const turns = parseTranscriptTurns(s.cli, s.contentSourcePath)
    res.json({ turns })
  } catch {
    res.json({ turns: [] })
  }
})
