// `berth task` / `berth project` — manage Berth's canonical task/project data from the terminal.
// Talks to the RUNNING server's REST API so the server stays the single writer and runs sync. Pure
// helpers (flag parsing, task selection, formatting) are exported for unit tests; the runners do I/O.

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

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function baseUrl(flags: Record<string, string | boolean>): string {
  const host = (flags.host as string) ?? process.env.HOST ?? '127.0.0.1'
  const port = (flags.port as string) ?? process.env.PORT ?? '7777'
  const h = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${h}:${port}`
}

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

const TASK_HELP = `berth task — manage tasks (talks to a running \`berth start\`)

  berth task [list] [--status S] [--project P] [--json]   List tasks
  berth task add "<text>" [--project P] [--confirm] [--create-option]
  berth task done <id|title>                              Mark a task done
  berth task status <id|title> <status>                   Set status
  berth task set <id|title> [--title T] [--status S] [--priority P]
  berth task log <id|title> "<text>"                      Append a dated entry to the task's progress log
  berth task doc <id|title> [--print]                     Print the task's context-doc path (and body with --print)
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
      const { ref } = await post(base, '/api/context', { kind: 'task', key: t.id, title: t.title })
      const d = await json(base, `/api/doc?path=${encodeURIComponent(ref)}`)
      console.log(d.path)
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
  berth project add <name> [--hue HUE]         Create a project`

export async function runProjectCli(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const { flags, pos } = parseFlags(argv[0] === sub ? argv.slice(1) : argv)
  const base = baseUrl(flags)

  if (sub === 'help' || flags.help) { console.log(PROJECT_HELP); return }

  switch (sub) {
    case 'list': {
      const projects = (await json(base, '/api/projects')).projects ?? []
      if (flags.json) { console.log(JSON.stringify(projects, null, 2)); return }
      console.log(projects.length
        ? projects.map((p: any) => `${p.archived ? '🗄 ' : '   '}${p.name}`).join('\n')
        : '（没有项目）')
      return
    }
    case 'add': {
      const name = pos.join(' ').trim()
      if (!name) throw new Error('用法：berth project add <项目名>')
      await post(base, '/api/projects/create', { name, hue: flags.hue })
      console.log(`✓ 已创建项目  ${name}`)
      return
    }
    default:
      throw new Error(`未知子命令：project ${sub}\n\n${PROJECT_HELP}`)
  }
}
