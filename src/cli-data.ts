// `berth task` / `berth project` — manage Berth's canonical task/project data from the terminal.
// Talks to the RUNNING server's REST API so the server stays the single writer and runs sync. Pure
// helpers (flag parsing, task selection, formatting) are exported for unit tests; the runners do I/O.

import { readServerFile } from './server-discovery'
import { canonicalPathKey } from './path-normalize'

export interface ParsedFlags { flags: Record<string, string | boolean>; pos: string[] }

const BOOL_FLAGS = new Set(['json', 'confirm', 'create-option', 'print'])

/** Tiny flag parser: `--key val`, `--bool`, and positionals. Side-effect-free. */
export function parseFlags(argv: string[]): ParsedFlags {
  const flags: Record<string, string | boolean> = {}
  const pos: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (BOOL_FLAGS.has(key)) flags[key] = true
      else flags[key] = argv[++i]
    } else pos.push(a)
  }
  return { flags, pos }
}

export interface TaskLite { id: string; title: string; status: string | null; priority: string | null; project: string | null }

/**
 * Resolve a human-typed task reference to matching tasks. Tries: exact id, id-prefix (≥6 chars),
 * then case-insensitive title substring. Returns ALL matches so the caller can disambiguate.
 */
export function selectTask<T extends TaskLite>(tasks: T[], query: string): T[] {
  const q = query.trim()
  if (!q) return []
  const exact = tasks.find(t => t.id === q)
  if (exact) return [exact]
  if (q.length >= 6) {
    const byPrefix = tasks.filter(t => t.id.startsWith(q))
    if (byPrefix.length) return byPrefix
  }
  const lc = q.toLowerCase()
  return tasks.filter(t => (t.title || '').toLowerCase().includes(lc))
}

/** Pick a sensible "done" status from the configured vocabulary. */
export function pickDoneStatus(statuses: string[]): string | null {
  return statuses.find(s => /完成|done|closed|关闭/i.test(s)) ?? statuses[statuses.length - 1] ?? null
}

function padEndW(s: string, w: number): string {
  // crude CJK-aware pad: count wide chars as 2.
  let width = 0
  for (const ch of s) width += ch.charCodeAt(0) > 0x2e7f ? 2 : 1
  return s + ' '.repeat(Math.max(0, w - width))
}

export function formatTaskLine(t: TaskLite): string {
  return `${padEndW(t.status || '-', 8)} ${padEndW(t.priority || '-', 3)} ${padEndW(t.project || '-', 16)} ${t.title}   [${t.id.slice(0, 8)}]`
}

export function formatTaskTable(tasks: TaskLite[]): string {
  if (!tasks.length) return '（没有任务）'
  return tasks.map(formatTaskLine).join('\n')
}

export interface ProjectLite { id: string; name: string; hue?: string | null; archived?: boolean }

export function selectProject<T extends ProjectLite>(projects: T[], query: string): T[] {
  const q = query.trim()
  if (!q) return []
  const exact = projects.find(p => p.id === q || p.name === q)
  if (exact) return [exact]
  if (q.length >= 6) {
    const byPrefix = projects.filter(p => p.id.startsWith(q))
    if (byPrefix.length) return byPrefix
  }
  const lc = q.toLowerCase()
  return projects.filter(p => (p.name || '').toLowerCase().includes(lc))
}

function formatProjectLine(p: ProjectLite): string {
  return `${p.archived ? '归档' : '活跃'} ${padEndW(p.name, 20)} [${p.id.slice(0, 8)}]`
}

function formatProjectTable(projects: ProjectLite[]): string {
  if (!projects.length) return '（没有项目）'
  return projects.map(formatProjectLine).join('\n')
}

export interface SessionLite {
  sessionId: string; cli: string; cwd: string | null; updatedAt: number
  todoKey: string | null; activity?: string | null
}

/**
 * Resolve "my current session" for self-bind. Prefers the BERTH_SESSION_ID injected at PTY launch
 * (deterministic for claude/coco). Falls back to the most-recently-updated session whose cwd matches
 * the caller's cwd (same heuristic as server/reconcile.ts) — used for codex before reconcile binds it.
 * `canon` is injectable for tests; defaults to the symlink-resolving path key.
 */
export function selectCurrentSession(
  sessions: SessionLite[],
  opts: { berthSessionId?: string; cwd: string; canon?: (p: string) => string },
): { sessionId: string; inferred: boolean } | null {
  if (opts.berthSessionId) return { sessionId: opts.berthSessionId, inferred: false }
  const canon = opts.canon ?? canonicalPathKey
  const target = canon(opts.cwd)
  const matches = sessions.filter(s => s.cwd != null && canon(s.cwd) === target)
  if (!matches.length) return null
  const best = matches.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  return { sessionId: best.sessionId, inferred: true }
}

export function formatSessionLine(s: SessionLite, taskTitles: Map<string, string>): string {
  const task = s.todoKey ? (taskTitles.get(s.todoKey) ?? s.todoKey.slice(0, 8)) : '-'
  return `${padEndW(s.cli, 6)} ${padEndW(s.activity || '-', 8)} ${padEndW(task, 20)} ${padEndW(s.cwd || '-', 28)} [${s.sessionId.slice(0, 8)}]`
}

function formatSessionTable(sessions: SessionLite[], taskTitles: Map<string, string>): string {
  if (!sessions.length) return '（没有会话）'
  return sessions.map(s => formatSessionLine(s, taskTitles)).join('\n')
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

export function __resolveBaseUrl(flags: Record<string, string | boolean>): string {
  const host = (flags.host as string) ?? process.env.BERTH_HOST ?? process.env.HOST ?? '127.0.0.1'
  // only consult the port file when nothing more specific was given
  const file = (!flags.port && !process.env.BERTH_PORT && !process.env.PORT) ? readServerFile() : null
  const port = (flags.port as string) ?? process.env.BERTH_PORT ?? process.env.PORT ?? (file ? String(file.port) : '7777')
  const h = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${h}:${port}`
}
function baseUrl(flags: Record<string, string | boolean>): string { return __resolveBaseUrl(flags) }

async function api(base: string, path: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(base + path, init)
  } catch {
    // The server isn't running (or not at this address). Tell the user exactly how to start it.
    const m = /:(\d+)$/.exec(base)
    const port = m ? m[1] : '7777'
    const startCmd = port === '7777' ? 'berth start' : `berth start --port ${port}`
    throw new Error(
      `Berth 服务未运行（连不上 ${base}）。\n` +
      `请在另一个终端先启动：${startCmd}\n` +
      `（CLI 默认连 127.0.0.1:7777；非默认端口用 --port 或 $PORT，且两边保持一致。）`,
    )
  }
  const text = await res.text()
  let json: any = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`)
  return json
}

const json = (b: string, p: string) => api(b, p)
const post = (b: string, p: string, body: any) => api(b, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const patch = (b: string, p: string, body: any) => api(b, p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const del = (b: string, p: string) => api(b, p, { method: 'DELETE' })

async function getTasks(base: string): Promise<TaskLite[]> {
  return (await json(base, '/api/todos')).todos ?? []
}
async function resolveOne(base: string, query: string): Promise<TaskLite> {
  const matches = selectTask(await getTasks(base), query)
  if (matches.length === 0) throw new Error(`未找到匹配的任务：「${query}」`)
  if (matches.length > 1) {
    throw new Error(`「${query}」匹配到多个任务，请用更精确的标题或 id：\n` + formatTaskTable(matches))
  }
  return matches[0]
}

async function getProjects(base: string): Promise<ProjectLite[]> {
  return (await json(base, '/api/projects')).projects ?? []
}
async function resolveProjectOne(base: string, query: string): Promise<ProjectLite> {
  const matches = selectProject(await getProjects(base), query)
  if (matches.length === 0) throw new Error(`未找到匹配的项目：「${query}」`)
  if (matches.length > 1) {
    throw new Error(`「${query}」匹配到多个项目，请用更精确的名称或 id：\n` + formatProjectTable(matches))
  }
  return matches[0]
}

async function getSessions(base: string): Promise<SessionLite[]> {
  return (await json(base, '/api/sessions')) ?? []
}

/** I/O wrapper around selectCurrentSession: fetch sessions, resolve, throw a helpful error if unresolved. */
async function resolveCurrentSession(base: string): Promise<string> {
  const picked = selectCurrentSession(await getSessions(base), {
    berthSessionId: process.env.BERTH_SESSION_ID,
    cwd: process.cwd(),
  })
  if (!picked) {
    throw new Error(
      '无法确定当前会话（环境里没有 BERTH_SESSION_ID，也没有匹配当前目录的会话）。\n' +
      '请显式指定 <sessionId>，或用 `berth session list` 查看可用会话。',
    )
  }
  if (picked.inferred) console.error(`（按当前目录推断的会话：${picked.sessionId.slice(0, 8)}）`)
  return picked.sessionId
}

const TASK_HELP = `berth task — manage tasks (talks to a running \`berth start\`)

  berth task [list] [--status S] [--project P] [--json]   List tasks
  berth task add "<text>" [--project P] [--confirm] [--create-option]
  berth task done <id|title>                              Mark a task done
  berth task status <id|title> <status>                   Set status
  berth task set <id|title> [--title T] [--status S] [--priority P]
  berth task log <id|title> "<text>"                      Append a dated entry to the task's progress log
  berth task doc <id|title> [--print]                     Print the task's context-doc path + protocol(AGENTS.md) path (and body with --print)
  berth task rm <id|title>                                Delete a task
  berth task sync [--source ID]                           Push local edits + pull external changes

  --port N / --host H   Reach a server not on 127.0.0.1:7777 (or $PORT)`

export async function runTaskCli(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const { flags, pos } = parseFlags(argv[0] === sub ? argv.slice(1) : argv)
  const base = baseUrl(flags)

  if (sub === 'help' || flags.help) { console.log(TASK_HELP); return }

  switch (sub) {
    case 'list': {
      let tasks = await getTasks(base)
      if (flags.status) tasks = tasks.filter(t => t.status === flags.status)
      if (flags.project) tasks = tasks.filter(t => t.project === flags.project)
      console.log(flags.json ? JSON.stringify(tasks, null, 2) : formatTaskTable(tasks))
      return
    }
    case 'add': {
      const text = pos.join(' ').trim()
      if (!text) throw new Error('用法：berth task add "<任务内容>"')
      const r = await post(base, '/api/todos', {
        text, projectId: flags.project, confirm: !!flags.confirm, createOption: !!flags['create-option'],
      })
      if (r.status === 'created') console.log(`✓ 已创建  ${r.record.title}${r.record.project ? '  @' + r.record.project : ''}  [${String(r.record.id).slice(0, 8)}]`)
      else if (r.status === 'duplicate') console.log(`已存在同名任务：${r.existing.title}  [${String(r.existing.id).slice(0, 8)}]（加 --confirm 可强制新建）`)
      else if (r.status === 'needs-confirm') {
        const cands = (r.candidates || []).map((c: any) => `${c.name}(${Math.round(c.confidence * 100)}%)`).join(', ')
        console.log(`需要确认项目${cands ? '，候选：' + cands : ''}。\n用 --project <名称> 指定，或 --confirm 创建为无项目任务，或 --project <新名> --create-option 新建项目。`)
      } else console.log(JSON.stringify(r))
      return
    }
    case 'done': {
      const t = await resolveOne(base, pos.join(' '))
      const statuses = (await json(base, '/api/settings')).statuses ?? []
      const done = pickDoneStatus(statuses)
      if (!done) throw new Error('未配置任何状态，无法标记完成。')
      await patch(base, `/api/todos/${encodeURIComponent(t.id)}`, { status: done })
      console.log(`✓ ${t.title} → ${done}`)
      return
    }
    case 'status': {
      const status = pos[pos.length - 1]
      const t = await resolveOne(base, pos.slice(0, -1).join(' '))
      await patch(base, `/api/todos/${encodeURIComponent(t.id)}`, { status })
      console.log(`✓ ${t.title} → ${status}`)
      return
    }
    case 'set': {
      const t = await resolveOne(base, pos.join(' '))
      const body: any = {}
      if (flags.title) body.title = flags.title
      if (flags.status) body.status = flags.status
      if (flags.priority) body.priority = flags.priority
      if (!Object.keys(body).length) throw new Error('用 --title / --status / --priority 指定要修改的字段。')
      await patch(base, `/api/todos/${encodeURIComponent(t.id)}`, body)
      console.log(`✓ 已更新  ${t.title}`)
      return
    }
    case 'progress':
      throw new Error("'berth task progress' 已废弃：进展现在追加到任务上下文文档的「进展日志」。\n请改用：  berth task log <id|title> \"<进展文本>\"")
    case 'doc': {
      const t = await resolveOne(base, pos.join(' '))
      const { ref, protocolPath } = await post(base, '/api/context', { kind: 'task', key: t.id, title: t.title })
      const d = await json(base, `/api/doc?path=${encodeURIComponent(ref)}`)
      console.log(d.path)
      if (protocolPath) console.log(`协议（维护规则/写入分工，按需 Read）: ${protocolPath}`)
      if (flags.print) { console.log(''); console.log(d.content) }
      return
    }
    case 'log': {
      const text = pos.slice(1).join(' ').trim()
      if (!text) throw new Error('用法：berth task log <id|title> "<进展文本>"')
      const t = await resolveOne(base, pos[0] ?? '')
      const r = await post(base, '/api/context/log', { kind: 'task', key: t.id, text })
      console.log(`✓ 已追加进展  ${t.title}${r.rotated ? '（已滚动归档）' : ''}`)
      return
    }
    case 'rm': {
      const t = await resolveOne(base, pos.join(' '))
      await del(base, `/api/todos/${encodeURIComponent(t.id)}`)
      console.log(`✓ 已删除  ${t.title}`)
      return
    }
    case 'sync': {
      const q = flags.source ? `?source=${encodeURIComponent(String(flags.source))}` : ''
      const r = await post(base, `/api/sync${q}`, {})
      const n = (r.conflicts || []).length
      console.log(`同步完成：↑${r.pushed ?? 0} 推送 ↓${r.pulled ?? 0} 拉取${n ? `；⚠ ${n} 个冲突，请在 Berth 界面解决` : ''}`)
      return
    }
    default:
      throw new Error(`未知子命令：task ${sub}\n\n${TASK_HELP}`)
  }
}

const PROJECT_HELP = `berth project — manage projects

  berth project [list] [--json]                List projects
  berth project add <name> [--hue HUE]         Create a project
  berth project rename <id|name> <new-name>    Rename a project
  berth project set <id|name> [--name N] [--hue HUE]
  berth project archive <id|name>              Archive a project
  berth project unarchive <id|name>            Unarchive a project
  berth project rm <id|name>                   Delete a project`

export async function runProjectCli(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const { flags, pos } = parseFlags(argv[0] === sub ? argv.slice(1) : argv)
  const base = baseUrl(flags)

  if (sub === 'help' || flags.help) { console.log(PROJECT_HELP); return }

  switch (sub) {
    case 'list': {
      const projects = (await json(base, '/api/projects')).projects ?? []
      if (flags.json) { console.log(JSON.stringify(projects, null, 2)); return }
      console.log(formatProjectTable(projects))
      return
    }
    case 'add': {
      const name = pos.join(' ').trim()
      if (!name) throw new Error('用法：berth project add <项目名>')
      await post(base, '/api/projects/create', { name, hue: flags.hue })
      console.log(`✓ 已创建项目  ${name}`)
      return
    }
    case 'rename': {
      const ref = pos[0]
      const name = pos.slice(1).join(' ').trim()
      if (!ref || !name) throw new Error('用法：berth project rename <id|name> <新项目名>')
      const p = await resolveProjectOne(base, ref)
      const r = await patch(base, `/api/projects/${encodeURIComponent(p.id)}`, { name })
      console.log(`✓ 已重命名项目  ${p.name} → ${r.project?.name ?? name}`)
      return
    }
    case 'set': {
      const ref = pos.join(' ')
      if (!ref) throw new Error('用法：berth project set <id|name> [--name N] [--hue HUE]')
      const body: any = {}
      if (flags.name) body.name = flags.name
      if (flags.hue) body.hue = flags.hue
      if (!Object.keys(body).length) throw new Error('用 --name / --hue 指定要修改的字段。')
      const p = await resolveProjectOne(base, ref)
      const r = await patch(base, `/api/projects/${encodeURIComponent(p.id)}`, body)
      console.log(`✓ 已更新项目  ${r.project?.name ?? p.name}`)
      return
    }
    case 'archive':
    case 'unarchive': {
      const ref = pos.join(' ')
      if (!ref) throw new Error(`用法：berth project ${sub} <id|name>`)
      const p = await resolveProjectOne(base, ref)
      const on = sub === 'archive'
      await post(base, '/api/projects/archive', { projectId: p.id, on })
      console.log(`✓ 已${on ? '归档' : '取消归档'}项目  ${p.name}`)
      return
    }
    case 'rm':
    case 'delete': {
      const ref = pos.join(' ')
      if (!ref) throw new Error(`用法：berth project ${sub} <id|name>`)
      const p = await resolveProjectOne(base, ref)
      await del(base, `/api/projects/${encodeURIComponent(p.id)}`)
      console.log(`✓ 已删除项目  ${p.name}`)
      return
    }
    default:
      throw new Error(`未知子命令：project ${sub}\n\n${PROJECT_HELP}`)
  }
}

const SESSION_HELP = `berth session — bind an existing session (running or finished) to a task

  berth session bind [<sessionId>] <id|title> [--project P]   Bind a session to a task (re-binds if already bound)
  berth session unbind [<sessionId>]                          Clear a session's task binding
  berth session list [--task <id|title>] [--json]             List sessions and their bound task

  <sessionId> omitted → the current session (from $BERTH_SESSION_ID, else matched by cwd).
  When omitting <sessionId>, quote a multi-word title: berth session bind "fix the login bug".
  --port N / --host H   Reach a server not on 127.0.0.1:7777 (or $PORT)`

export async function runSessionCli(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const { flags, pos } = parseFlags(argv[0] === sub ? argv.slice(1) : argv)
  const base = baseUrl(flags)

  if (sub === 'help' || flags.help) { console.log(SESSION_HELP); return }

  switch (sub) {
    case 'bind': {
      // 2+ positionals → explicit "<sessionId> <task...>"; 1 → "<task...>" against the current session.
      const explicit = pos.length >= 2
      const taskRef = (explicit ? pos.slice(1) : pos).join(' ').trim()
      if (!taskRef) throw new Error('用法：berth session bind [<sessionId>] <id|title> [--project P]')
      const sessionId = explicit ? pos[0] : await resolveCurrentSession(base)
      const t = await resolveOne(base, taskRef)
      const projectId = flags.project ? (await resolveProjectOne(base, String(flags.project))).id : undefined
      await post(base, '/api/edge', { sessionId, todoKey: t.id, projectId })
      console.log(`✓ 已绑定会话 ${sessionId.slice(0, 8)} → ${t.title}`)
      return
    }
    case 'unbind': {
      const sessionId = pos.length >= 1 ? pos[0] : await resolveCurrentSession(base)
      // No todoKey/projectId → server clears the session's edge but leaves its project attach intact.
      await post(base, '/api/edge', { sessionId })
      console.log(`✓ 已解绑会话 ${sessionId.slice(0, 8)}`)
      return
    }
    case 'list': {
      let sessions = await getSessions(base)
      if (flags.task) {
        const t = await resolveOne(base, String(flags.task))
        sessions = sessions.filter(s => s.todoKey === t.id)
      }
      if (flags.json) { console.log(JSON.stringify(sessions, null, 2)); return }
      const titles = new Map((await getTasks(base)).map(t => [t.id, t.title]))
      console.log(formatSessionTable(sessions, titles))
      return
    }
    default:
      throw new Error(`未知子命令：session ${sub}\n\n${SESSION_HELP}`)
  }
}
