import { describe, it, expect, vi } from 'vitest'

// Mock the lark-cli boundary (promisify(execFile) is built at module load).
let execMock: (...args: any[]) => any
vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => execMock(...args),
}))

import { FeishuBitableAdapter, parseFeishuUrl, buildFieldMap } from '../src/data/sync/feishu'
import type { DataSourceRow, Task } from '../src/data/types'

function mockExec(router: (args: string[]) => string) {
  execMock = vi.fn((_bin: string, args: string[], opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb
    try { callback(null, { stdout: router(args), stderr: '' }) } catch (e) { callback(e) }
  })
}
async function drain() {
  const { getQueue } = await import('../src/bitable/queue-singleton')
  await getQueue().drain()
}

const cfg = {
  baseToken: 'B', tableId: 'T', projectFieldId: 'F',
  fieldMap: { title: '标题', status: '状态', priority: '优先级', project: '项目领域', detailDoc: '详情文档', progress: '进展记录' },
  defaultStatus: '待办', defaultPriority: 'P1', detailDocFormat: 'obsidian', obsidianVaultName: 'Obsidian Vault',
}
const src: DataSourceRow = { id: 'feishu-main', kind: 'feishu-bitable', label: null, config: cfg, pullMode: 'manual', pushMode: 'manual', enabled: true }
const ctx = { docsRoot: '/root' }
const a = new FeishuBitableAdapter()

describe('parseFeishuUrl', () => {
  it('extracts base token + table id from a /base/ URL', () => {
    expect(parseFeishuUrl('https://x.feishu.cn/base/NMCwAAAA?table=tblABC&view=vewX'))
      .toEqual({ baseToken: 'NMCwAAAA', tableId: 'tblABC' })
  })
  it('handles /wiki/ links and missing table param', () => {
    expect(parseFeishuUrl('https://x.feishu.cn/wiki/Wabc123')).toEqual({ baseToken: 'Wabc123', tableId: null })
  })
  it('returns nulls for a non-bitable URL', () => {
    expect(parseFeishuUrl('https://example.com/whatever')).toEqual({ baseToken: null, tableId: null })
  })
})

describe('buildFieldMap', () => {
  it('maps canonical roles by name synonyms', () => {
    const fields = [
      { id: 'f1', name: '标题', type: 'text' },
      { id: 'f2', name: '状态', type: 'select' },
      { id: 'f3', name: '优先级', type: 'select' },
      { id: 'f4', name: '项目领域', type: 'select' },
      { id: 'f5', name: '详情文档', type: 'text' },
      { id: 'f6', name: '进展记录', type: 'text' },
    ]
    expect(buildFieldMap(fields)).toEqual({
      title: '标题', status: '状态', priority: '优先级', project: '项目领域', detailDoc: '详情文档', progress: '进展记录',
    })
  })
  it('falls back to the first text field for title and defaults for unmatched roles', () => {
    const fields = [{ id: 'f1', name: 'Task name', type: 'text' }, { id: 'f2', name: 'State', type: 'select' }]
    const m = buildFieldMap(fields)
    expect(m.title).toBe('Task name')
    expect(m.status).toBe('状态')   // no synonym matched → default
  })
})

describe('connectFromUrl', () => {
  it('parses the URL, introspects fields, and returns a ready source (config hidden)', async () => {
    mockExec((args) => {
      if (args.includes('+table-list')) return JSON.stringify({ data: { items: [{ table_id: 'tblABC', name: '个人待办' }] } })
      if (args.includes('+field-list')) return JSON.stringify({ data: { fields: [
        { id: 'f1', name: '标题', type: 'text' },
        { id: 'f2', name: '状态', type: 'select', options: [{ name: '待办' }, { name: '进行中' }] },
        { id: 'f3', name: '优先级', type: 'select', options: [{ name: 'P1' }, { name: 'P0' }] },
        { id: 'f4', name: '项目领域', type: 'select' },
        { id: 'f5', name: '详情文档', type: 'text' },
        { id: 'f6', name: '进展记录', type: 'text' },
      ] } })
      return '{}'
    })
    const r = await a.connectFromUrl('https://x.feishu.cn/base/NMCwAAAA?table=tblABC', { docsRoot: '/Users/me/Obsidian Vault' })
    expect(r.id).toBe('feishu-tblABC')
    expect(r.label).toBe('个人待办')
    expect(r.config.baseToken).toBe('NMCwAAAA')
    expect(r.config.tableId).toBe('tblABC')
    expect(r.config.projectFieldId).toBe('f4')
    expect(r.config.fieldMap.title).toBe('标题')
    expect(r.config.defaultStatus).toBe('待办')
    expect(r.config.statusValues).toEqual(['待办', '进行中'])
    expect(r.config.obsidianVaultName).toBe('Obsidian Vault')
  })

  it('throws a friendly error when the URL has no base token', async () => {
    await expect(a.connectFromUrl('https://example.com/nope', { docsRoot: '/x' })).rejects.toThrow(/无法.*解析/)
  })
})

describe('FeishuBitableAdapter', () => {
  it('pullTasks parses the column envelope via fieldMap + translates obsidian detailDoc to internal ref', async () => {
    mockExec(() => JSON.stringify({ data: {
      fields: ['标题', '状态', '优先级', '项目领域', '详情文档', '进展记录'],
      record_id_list: ['rec1', 'rec2'],
      data: [
        ['任务一', ['进行中'], ['P0'], ['Berth'], 'obsidian://open?vault=Obsidian%20Vault&file=projects%2Ffoo', '记录1'],
        ['', ['待办'], ['P1'], [], '', ''],   // empty title row → skipped
      ],
    } }))
    const recs = await a.pullTasks(src, ctx)
    expect(recs).toHaveLength(1)
    expect(recs[0].externalId).toBe('rec1')
    expect(recs[0].fields.title).toBe('任务一')
    expect(recs[0].fields.status).toBe('进行中')
    expect(recs[0].fields.project).toBe('Berth')
    expect(recs[0].fields.detailDoc).toBe('projects/foo.md')   // obsidian → internal ref
    expect(typeof recs[0].hash).toBe('string')
  })

  it('pullTasks unwraps the markdown-wrapped obsidian detailDoc form (gotcha #1)', async () => {
    const wrapped = '[obsidian://open?vault=Obsidian%20Vault&file=projects%2F20260521N2-cal](http://obsidian://open?vault=Obsidian%20Vault&file=projects%2F20260521N2-cal)'
    mockExec(() => JSON.stringify({ data: {
      fields: ['标题', '状态', '优先级', '项目领域', '详情文档', '进展记录'],
      record_id_list: ['rec1'],
      data: [['任务', ['待办'], ['P1'], ['Berth'], wrapped, '']],
    } }))
    const recs = await a.pullTasks(src, ctx)
    expect(recs[0].fields.detailDoc).toBe('projects/20260521N2-cal.md')
  })

  it('createTask emits a batch-create with mapped fields + defaults and returns the record id', async () => {
    let createArgs: string[] | null = null
    mockExec((args) => {
      if (args.includes('+record-batch-create')) { createArgs = args; return JSON.stringify({ data: { record_id_list: ['rec_new'] } }) }
      return '{}'
    })
    const task: Task = { id: 'u1', title: '新任务', status: null, priority: null, projectId: 'p1', project: 'Berth', detailDoc: 'tasks/u1/index.md', progress: null, updatedAt: 1, syncedAt: 0, deleted: false }
    const id = await a.createTask(src, task, ctx)
    await drain()
    expect(id).toBe('rec_new')
    const payload = JSON.parse(createArgs!.find(x => x.startsWith('{') && x.includes('标题'))!)
    expect(payload.fields).toContain('项目领域')
    expect(JSON.stringify(payload.rows)).toContain('待办')   // default status
    expect(JSON.stringify(payload.rows)).toContain('P1')     // default priority
    expect(JSON.stringify(payload.rows)).toContain('obsidian://')  // detailDoc translated back
  })

  it('updateTask maps the patch onto Chinese field names', async () => {
    let upsertArgs: string[] | null = null
    mockExec((args) => {
      if (args.includes('+record-upsert')) { upsertArgs = args; return '{}' }
      return '{}'
    })
    await a.updateTask(src, 'rec1', { status: '已完成', title: '改名' }, ctx)
    await drain()
    expect(upsertArgs).toContain('--record-id')
    const payload = JSON.parse(upsertArgs!.find(x => x.startsWith('{'))!)
    expect(payload['状态']).toBe('已完成')
    expect(payload['标题']).toBe('改名')
  })

  it('ensureProjectOption PUTs the full option list (append, no dup)', async () => {
    let updateArgs: string[] | null = null
    mockExec((args) => {
      if (args.includes('+field-get')) return JSON.stringify({ data: { field: { options: [{ name: 'Berth', hue: 'Blue' }] } } })
      if (args.includes('+field-update')) { updateArgs = args; return JSON.stringify({ data: { field: {} } }) }
      return '{}'
    })
    await a.ensureProjectOption(src, '新项目', 'Green', ctx)
    await drain()
    const payload = JSON.parse(updateArgs!.find(x => x.startsWith('{') && x.includes('options'))!)
    expect(payload.options.map((o: any) => o.name).sort()).toEqual(['Berth', '新项目'])
    expect(payload.options.find((o: any) => o.name === '新项目').hue).toBe('Green')
  })

  it('deleteTask issues a record-delete', async () => {
    let deleted = false
    mockExec((args) => { if (args.includes('+record-delete')) { deleted = true } return '{}' })
    await a.deleteTask(src, 'rec1', ctx)
    await drain()
    expect(deleted).toBe(true)
  })
})
