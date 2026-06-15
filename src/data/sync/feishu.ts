import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import type { DataSourceAdapter, AdapterContext, AdapterAvailability, ConnectResult } from './adapter'
import type { DataSourceRow, NormalizedRecord, Task, TaskFields } from '../types'
import { enqueueWrite } from '../../bitable/queue-singleton'
import { hashFields } from './hash'
import { commandExists } from '../../platform'

const exec = promisify(execFile)
const MAXBUF = 8 * 1024 * 1024

/**
 * Translate a raw lark-cli spawn failure into an actionable message. The most common case for a
 * general-public user is `lark-cli` simply not being installed (ENOENT) — surface that as "optional
 * plugin not installed" rather than a cryptic `spawn lark-cli ENOENT`.
 */
export function friendlyLarkError(err: any): Error {
  // A missing binary surfaces as a spawn error with `code === 'ENOENT'`. Match ONLY that — a non-zero
  // exit carries a numeric `code` and lark-cli's stderr (which may itself mention ENOENT); misreading
  // that as "not installed" would drop the real diagnostics. Pass other errors through untouched so
  // their stderr/message survive.
  if (err?.code === 'ENOENT') {
    return new Error(
      'lark-cli not found on PATH. Feishu sync is an optional plugin that needs the internal ' +
      'lark-cli tool installed and authed; install it or disable/remove this data source. The rest of Berth ' +
      'works without it.',
    )
  }
  if (err instanceof Error) return err
  return new Error(err?.message ?? String(err))
}

/** Run lark-cli, returning stdout; ENOENT and friends are translated via friendlyLarkError. */
async function runLark(args: string[], maxBuffer = MAXBUF): Promise<string> {
  try {
    const { stdout } = await exec('lark-cli', args, { maxBuffer })
    return stdout
  } catch (e) {
    throw friendlyLarkError(e)
  }
}

// Legal 项目领域 option hues; anything else falls back to Gray.
const LEGAL_HUES = ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Turquoise', 'Wathet', 'Blue', 'Carmine', 'Purple', 'Gray']

/**
 * Per-source config (parsed from data_source.config_json). Everything external-shaped lives here —
 * NO ids or field names are hardcoded in this module.
 */
export interface FeishuConfig {
  baseToken: string
  tableId: string
  projectFieldId: string
  fieldMap: { title: string; status: string; priority: string; project: string; detailDoc: string; progress: string }
  statusValues?: string[]
  priorityValues?: string[]
  defaultStatus?: string
  defaultPriority?: string
  detailDocFormat?: 'obsidian' | 'path'
  obsidianVaultName?: string
}

/**
 * Feishu bitable adapter. The ONLY place that knows lark-cli, recordIds, Chinese field names, and
 * obsidian:// link translation. Reads/writes are normalized to Berth's domain fields; pushes go
 * through the shared serial write queue (≥800ms spacing).
 */
export class FeishuBitableAdapter implements DataSourceAdapter {
  readonly kind = 'feishu-bitable'

  async checkAvailable(): Promise<AdapterAvailability> {
    if (await commandExists('lark-cli')) return { available: true }
    return {
      available: false,
      reason: 'lark-cli not installed. Feishu sync is an optional plugin (needs the internal lark-cli tool).',
    }
  }

  async pullTasks(src: DataSourceRow, _ctx: AdapterContext): Promise<NormalizedRecord[]> {
    const cfg = src.config as FeishuConfig
    const stdout = await runLark([
      'base', '+record-list', '--base-token', cfg.baseToken, '--table-id', cfg.tableId,
      '--format', 'json', '--as', 'user', '--limit', '200',
    ])
    const data = JSON.parse(stripNoise(stdout))?.data
    if (!data) throw new Error('feishu pullTasks: no data in response')

    const fields: string[] = data.fields ?? []
    const recordIds: string[] = data.record_id_list ?? []
    const rows: (unknown[] | null)[] = data.data ?? []
    const idx: Record<string, number> = {}
    fields.forEach((f, i) => { idx[f] = i })
    const m = cfg.fieldMap

    const out: NormalizedRecord[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      const title = strAt(row, idx[m.title])
      if (!title) continue   // skip empty/placeholder rows
      const detailRaw = strAt(row, idx[m.detailDoc])
      const fieldsOut: TaskFields = {
        title,
        status: selectAt(row, idx[m.status]),
        priority: selectAt(row, idx[m.priority]),
        project: selectAt(row, idx[m.project]),
        detailDoc: detailRaw == null ? null : this.externalToRef(cfg, detailRaw),
        progress: strAt(row, idx[m.progress]),
      }
      out.push({ externalId: recordIds[i] ?? '', fields: fieldsOut, hash: hashFields(fieldsOut) })
    }
    return out
  }

  async createTask(src: DataSourceRow, task: Task, _ctx: AdapterContext): Promise<string> {
    const cfg = src.config as FeishuConfig
    const m = cfg.fieldMap
    const fields: string[] = []
    const row: (string | null)[] = []
    const put = (name: string, value: string | null) => { fields.push(name); row.push(value) }

    put(m.title, task.title)
    put(m.status, task.status ?? cfg.defaultStatus ?? '待办')
    put(m.priority, task.priority ?? cfg.defaultPriority ?? 'P1')
    if (task.project != null) put(m.project, task.project)
    if (task.detailDoc != null) put(m.detailDoc, this.refToExternal(cfg, task.detailDoc))
    if (task.progress != null) put(m.progress, task.progress)

    const recordId = await enqueueWrite(`feishu:create:${src.id}:${task.id}`, async () => {
      const stdout = await runLark(['base', '+record-batch-create',
        '--base-token', cfg.baseToken, '--table-id', cfg.tableId,
        '--json', JSON.stringify({ fields, rows: [row] }), '--as', 'user'])
      const data = JSON.parse(stripNoise(stdout))?.data
      const id = data?.record_id_list?.[0] ?? data?.records?.[0]?.record_id ?? data?.record?.record_id
      if (!id) throw new Error('feishu createTask: record-batch-create returned no record_id')
      return id as string
    })
    return recordId
  }

  async updateTask(src: DataSourceRow, externalId: string, patch: Partial<TaskFields>, _ctx: AdapterContext): Promise<void> {
    const cfg = src.config as FeishuConfig
    const m = cfg.fieldMap
    const fields: Record<string, string | null> = {}
    if ('title' in patch) fields[m.title] = patch.title ?? ''
    if ('status' in patch) fields[m.status] = patch.status ?? null
    if ('priority' in patch) fields[m.priority] = patch.priority ?? null
    if ('project' in patch) fields[m.project] = patch.project ?? null
    if ('progress' in patch) fields[m.progress] = patch.progress ?? null
    if ('detailDoc' in patch) fields[m.detailDoc] = patch.detailDoc == null ? null : this.refToExternal(cfg, patch.detailDoc)
    if (Object.keys(fields).length === 0) return

    await enqueueWrite(`feishu:update:${src.id}:${externalId}`, async () => {
      await runLark(['base', '+record-upsert',
        '--base-token', cfg.baseToken, '--table-id', cfg.tableId, '--record-id', externalId,
        '--json', JSON.stringify(fields), '--as', 'user'])
    })
  }

  async deleteTask(src: DataSourceRow, externalId: string, _ctx: AdapterContext): Promise<void> {
    const cfg = src.config as FeishuConfig
    await enqueueWrite(`feishu:delete:${src.id}:${externalId}`, async () => {
      await runLark(['base', '+record-delete',
        '--base-token', cfg.baseToken, '--table-id', cfg.tableId,
        '--record-id', externalId, '--yes', '--as', 'user'])
    })
  }

  async pullProjects(src: DataSourceRow, _ctx: AdapterContext): Promise<{ name: string; hue?: string }[]> {
    const cfg = src.config as FeishuConfig
    const opts = await fetchFieldOptions(cfg)
    return opts.map(o => ({ name: o.name, hue: o.hue }))
  }

  async ensureProjectOption(src: DataSourceRow, name: string, hue: string | undefined, _ctx: AdapterContext): Promise<void> {
    name = name.trim()
    if (!name) throw new Error('empty project option name')
    const cfg = src.config as FeishuConfig
    const current = await fetchFieldOptions(cfg)
    if (current.some(o => o.name === name)) return
    const chosenHue = hue && LEGAL_HUES.includes(hue) ? hue : 'Gray'
    const options = [
      ...current.map(o => ({ name: o.name, hue: o.hue, lightness: o.lightness ?? 'Lighter' })),
      { name, hue: chosenHue, lightness: 'Lighter' },
    ]
    const payload = JSON.stringify({ name: cfg.fieldMap.project, type: 'select', multiple: false, options })
    await enqueueWrite(`feishu:option:${src.id}:${name}`, async () => {
      await runLark(['base', '+field-update',
        '--base-token', cfg.baseToken, '--table-id', cfg.tableId, '--field-id', cfg.projectFieldId,
        '--json', payload, '--yes', '--as', 'user'])
    })
  }

  /**
   * Paste-to-connect: parse a bitable URL → introspect fields → auto-build the full config. The user
   * only ever pastes the table's URL; everything below stays opaque to them.
   */
  async connectFromUrl(url: string, ctx: AdapterContext): Promise<ConnectResult> {
    const { baseToken, tableId: parsed } = parseFeishuUrl(url)
    if (!baseToken) {
      throw new Error('无法从该链接解析出多维表格地址。请在浏览器打开目标多维表格后，复制地址栏里的完整链接再粘贴（应包含 /base/… 或 /wiki/…）。')
    }
    let tableId = parsed
    let tables: { id: string; name: string }[] = []
    try { tables = await listTables(baseToken) } catch { /* table-list may be unavailable; fall back to parsed id */ }
    if (!tableId) {
      if (!tables.length) throw new Error('链接里没有指定数据表（缺少 ?table=…），且无法自动列出数据表。请在多维表格中打开目标数据表后再复制链接。')
      tableId = tables[0].id
    }

    const fields = await listFields(baseToken, tableId)
    if (!fields.length) throw new Error('该数据表没有可用字段。')
    const fieldMap = buildFieldMap(fields)
    const byName = (n: string) => fields.find(f => f.name === n)
    const projField = byName(fieldMap.project)
    const statusOpts = optionNames(byName(fieldMap.status))
    const priorityOpts = optionNames(byName(fieldMap.priority))

    const config: FeishuConfig = {
      baseToken, tableId,
      projectFieldId: projField && projField.type === 'select' ? projField.id : '',
      fieldMap,
      statusValues: statusOpts.length ? statusOpts : undefined,
      priorityValues: priorityOpts.length ? priorityOpts : undefined,
      defaultStatus: statusOpts[0] ?? '待办',
      defaultPriority: priorityOpts[0] ?? 'P1',
      detailDocFormat: 'obsidian',
      obsidianVaultName: ctx.docsRoot ? basename(ctx.docsRoot) : 'Obsidian Vault',
    }
    const label = tables.find(t => t.id === tableId)?.name || '飞书多维表格'
    return { id: `feishu-${tableId}`, label, config }
  }

  // ── detail-doc format translation (Feishu-specific; kept out of the core) ──────────
  /** External 详情文档 value → internal doc ref (path relative to docsRoot). */
  externalToRef(cfg: FeishuConfig, value: string): string {
    if (cfg.detailDocFormat !== 'obsidian') return value
    // The bitable value may be markdown-wrapped: `[obsidian://...&file=projects%2Fx](http://...)`.
    // Extract the file= param from anywhere; the char class must stop at ] ) " ' too (gotcha #1),
    // otherwise it runs past the link's closing bracket into the wrapper URL.
    const m = /[?&]file=([^&\]\)\s"']+)/.exec(value)
    if (!m) return value
    let ref = decodeURIComponent(m[1])
    if (!ref.endsWith('.md')) ref += '.md'
    return ref
  }
  /** Internal doc ref → external 详情文档 value. */
  refToExternal(cfg: FeishuConfig, ref: string): string {
    if (cfg.detailDocFormat !== 'obsidian') return ref
    const vault = encodeURIComponent(cfg.obsidianVaultName || 'Obsidian Vault')
    const file = encodeURIComponent(ref.replace(/\.md$/, ''))
    return `obsidian://open?vault=${vault}&file=${file}`
  }
}

// ── paste-to-connect helpers ──────────────────────────────────────────────────

interface FieldMeta { id: string; name: string; type: string; options?: { name: string }[] }

/** Parse a Feishu bitable URL into its base token + (optional) table id. */
export function parseFeishuUrl(url: string): { baseToken: string | null; tableId: string | null } {
  const u = (url || '').trim()
  const base = /\/(?:base|wiki)\/([A-Za-z0-9]+)/.exec(u)
  const table = /[?&]table=(tbl[A-Za-z0-9]+)/.exec(u)
  return { baseToken: base ? base[1] : null, tableId: table ? table[1] : null }
}

const ROLE_SYNONYMS: Record<keyof FeishuConfig['fieldMap'], string[]> = {
  title: ['标题', 'title', '名称', '任务', '主题', '事项', 'name'],
  status: ['状态', 'status'],
  priority: ['优先级', 'priority', '优先'],
  project: ['项目领域', '项目', '领域', '所属项目', '模块', '分类', 'project'],
  detailDoc: ['详情文档', '详情', '文档', 'detail', 'doc', '链接', '说明'],
  progress: ['进展记录', '进展', 'progress', '备注', '记录', 'note'],
}
const ROLE_DEFAULT: FeishuConfig['fieldMap'] = {
  title: '标题', status: '状态', priority: '优先级', project: '项目领域', detailDoc: '详情文档', progress: '进展记录',
}

/** Heuristically map a table's actual fields onto Berth's canonical roles (by name synonyms). */
export function buildFieldMap(fields: FieldMeta[]): FeishuConfig['fieldMap'] {
  const pick = (syns: string[]): string | null => {
    const norm = (s: string) => s.trim().toLowerCase()
    for (const s of syns) { const f = fields.find(f => norm(f.name) === norm(s)); if (f) return f.name }
    for (const s of syns) { const f = fields.find(f => norm(f.name).includes(norm(s))); if (f) return f.name }
    return null
  }
  // Title falls back to the table's primary (first) field, which bitable guarantees is the title.
  const firstText = fields.find(f => f.type === 'text')
  return {
    title: pick(ROLE_SYNONYMS.title) ?? firstText?.name ?? fields[0]?.name ?? ROLE_DEFAULT.title,
    status: pick(ROLE_SYNONYMS.status) ?? ROLE_DEFAULT.status,
    priority: pick(ROLE_SYNONYMS.priority) ?? ROLE_DEFAULT.priority,
    project: pick(ROLE_SYNONYMS.project) ?? ROLE_DEFAULT.project,
    detailDoc: pick(ROLE_SYNONYMS.detailDoc) ?? ROLE_DEFAULT.detailDoc,
    progress: pick(ROLE_SYNONYMS.progress) ?? ROLE_DEFAULT.progress,
  }
}

function optionNames(f: FieldMeta | undefined): string[] {
  return (f?.options ?? []).map(o => o.name).filter(Boolean)
}

async function listFields(baseToken: string, tableId: string): Promise<FieldMeta[]> {
  const stdout = await runLark(['base', '+field-list', '--base-token', baseToken, '--table-id', tableId, '--as', 'user'])
  const fields = JSON.parse(stripNoise(stdout))?.data?.fields ?? []
  return fields.map((f: any) => ({ id: f.id, name: f.name, type: f.type, options: f.options }))
}

async function listTables(baseToken: string): Promise<{ id: string; name: string }[]> {
  const stdout = await runLark(['base', '+table-list', '--base-token', baseToken, '--as', 'user'])
  const data = JSON.parse(stripNoise(stdout))?.data ?? {}
  const items = data.tables ?? data.items ?? []
  return items.map((t: any) => ({ id: t.id ?? t.table_id, name: t.name }))
}

interface RawOption { name: string; hue?: string; lightness?: string }
async function fetchFieldOptions(cfg: FeishuConfig): Promise<RawOption[]> {
  const stdout = await runLark(['base', '+field-get',
    '--base-token', cfg.baseToken, '--table-id', cfg.tableId, '--field-id', cfg.projectFieldId, '--as', 'user'],
    4 * 1024 * 1024)
  return (JSON.parse(stripNoise(stdout))?.data?.field?.options ?? []) as RawOption[]
}

function strAt(row: unknown[], i: number | undefined): string | null {
  if (i === undefined || i < 0 || i >= row.length) return null
  const v = row[i]
  if (typeof v === 'string' && v.length > 0) return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}
function selectAt(row: unknown[], i: number | undefined): string | null {
  if (i === undefined || i < 0 || i >= row.length) return null
  const v = row[i]
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  if (typeof v === 'string' && v.length > 0) return v
  return null
}
// lark-cli may prepend/append non-JSON notice lines; extract the JSON object.
function stripNoise(s: string): string {
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  return a >= 0 && b > a ? s.slice(a, b + 1) : s
}
