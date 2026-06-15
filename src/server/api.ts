import { Router } from 'express'
import { openSync, readSync, closeSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { getStore, getCache, refresh } from './store-singleton'
import { listProjects, createProject } from '../data/projects'
import { listTasks, createTask, updateTask, deleteTask } from '../data/tasks'
import { getDocStore, getDocsRoot } from '../data/docstore'
import { getTaskFieldConfig, setTaskFieldConfig } from '../data/task-config'
import { getAgentConfig, setAgentConfig, resolveBerthAgent } from '../data/agent-config'
import { getLocale, normalizeLocale, LOCALES } from '../i18n'
import { syncSource, resolveConflict } from '../data/sync/engine'
import { adapterCapabilities, getAdapter } from '../data/sync/registry'
import type { DataSourceRow, SyncMode } from '../data/types'
import { generateTitle } from '../agent/index'
import { extractUserGist } from '../agent/transcript'
import { readFileSync } from 'node:fs'
import { snapshotActivity } from './pty-registry'

function truncate(s: string | null, max: number): string | null {
  if (!s) return null
  return s.length <= max ? s : s.slice(0, max) + '…'
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
  const tryScript = (script: string, onFail: () => void) => {
    execFile('osascript', ['-e', script], { timeout: 300000 }, (err, stdout) => {
      if (err) return onFail()
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
      () => res.json({ cancelled: true }),
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
      paths: pathMap.get(p.id)?.paths ?? [],
    })),
  })
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

api.delete('/session-dirs', (req, res) => {
  const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim().replace(/\/+$/, '') : ''
  if (!cwd) return res.status(400).json({ error: 'cwd required' })
  getStore().removeSessionImportDir(cwd)
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// Add a cwd path to a project's path list (optionally make it the home cwd).
api.post('/projects/add-path', (req, res) => {
  const { projectId, name, cwd, isHome } = req.body ?? {}
  const store = getStore()
  const id = typeof projectId === 'string' ? projectId : (typeof name === 'string' ? store.resolveProjectId(name) : null)
  if (!id || typeof cwd !== 'string' || cwd.trim() === '')
    return res.status(400).json({ error: 'projectId:string, cwd:string required' })
  store.addProjectPath(id, cwd.trim(), !!isHome)
  res.json({ ok: true })
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

api.get('/todos', (_req, res) => {
  const store = getStore()
  const edgesMap = store.edgesByTodo()
  const todos = listTasks(store).map(t => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId, project: t.project,
    detailDoc: t.detailDoc, progress: truncate(t.progress, 300),
    sessions: edgesMap.get(t.id) ?? [],
  }))
  res.json({ error: null, todos })
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

// Edit a task's title / priority / status.
api.patch('/todos/:id', (req, res) => {
  const { title, priority, status } = req.body ?? {}
  try {
    updateTask(getStore(), req.params.id, { title, priority, status })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
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
  res.json({ docsRoot: getDocsRoot(store), locale: getLocale(store), locales: LOCALES, ...getTaskFieldConfig(store), agents: getAgentConfig(store) })
})

api.post('/settings', (req, res) => {
  const { docsRoot, locale, statuses, priorities, agents } = req.body ?? {}
  const store = getStore()
  if (typeof docsRoot === 'string' && docsRoot.trim()) store.setSetting('docsRoot', docsRoot.trim())
  if (typeof locale === 'string') store.setSetting('locale', normalizeLocale(locale))
  try {
    if (statuses !== undefined || priorities !== undefined) setTaskFieldConfig(store, { statuses, priorities })
    if (agents !== undefined) setAgentConfig(store, agents)
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'invalid settings' })
  }
  res.json({ ok: true, docsRoot: getDocsRoot(store), locale: getLocale(store), ...getTaskFieldConfig(store), agents: getAgentConfig(store) })
})

api.post('/sessions/:id/title', async (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s || !s.contentSourcePath) return res.status(404).json({ error: 'no readable transcript' })
  let head = ''
  // Read a larger head (65536 bytes) so that real user messages after big injected blocks are captured
  try { const fd = openSync(s.contentSourcePath, 'r'); const b = Buffer.alloc(65536); const n = readSync(fd, b, 0, 65536, 0); closeSync(fd); head = b.toString('utf8', 0, n) } catch {}
  const gist = extractUserGist(head) || head
  try {
    const title = await generateTitle(gist, resolveBerthAgent(getStore()))
    if (!title) return res.status(502).json({ error: 'agent returned empty title' })
    getStore().setTitleOverride(s.sessionId, title)
    res.json({ title })
  } catch (e: any) { res.status(502).json({ error: String(e?.message ?? e) }) }
})

api.patch('/sessions/:id/title', (req, res) => {
  const s = getCache().find(x => x.sessionId === req.params.id)
  if (!s) return res.status(404).json({ error: 'unknown session' })
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title) return res.status(400).json({ error: 'title required' })
  getStore().setTitleOverride(s.sessionId, title)
  res.json({ title })
})
