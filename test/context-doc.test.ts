import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocStore } from '../src/data/docstore'
import { ensureContextDoc, archivePathFor, rotateContextDocOnDisk, appendContextLogOnDisk, compactContextDocOnDisk, maintainContextDocOnDisk } from '../src/data/context-doc'
import { contextStrings } from '../src/i18n'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-ctxdoc-')) }

describe('context-doc', () => {
  it('ensureContextDoc creates a task context file from the template (created=true)', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: '登录页', projectName: 'Berth', locale: 'zh-CN' })
    expect(r.ref).toBe('tasks/abc/index.md')
    expect(r.created).toBe(true)
    expect(existsSync(r.abs)).toBe(true)
    expect(ds.readDoc(r.abs).content).toContain('登录页 — 任务上下文')
    expect(ds.readDoc(r.abs).content).toContain(contextStrings('zh-CN').logHeading)
  })

  it('ensureContextDoc never overwrites an existing file (created=false)', () => {
    const ds = new DocStore(tmpRoot())
    const first = ensureContextDoc(ds, 'project', 'Berth', { title: 'Berth', projectName: 'Berth', locale: 'zh-CN' })
    ds.writeDoc(first.abs, '# hand-edited')
    const second = ensureContextDoc(ds, 'project', 'Berth', { title: 'Berth', projectName: 'Berth', locale: 'zh-CN' })
    expect(second.created).toBe(false)
    expect(ds.readDoc(second.abs).content).toBe('# hand-edited')
  })

  it('archivePathFor sits next to the context file', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    expect(archivePathFor(r.abs)).toBe(join(ds.root, 'tasks/abc/progress-archive.md'))
  })

  it('rotateContextDocOnDisk rolls overflow entries into the sibling archive', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    const heading = contextStrings('zh-CN').logHeading
    const entries = Array.from({ length: 45 }, (_, i) => `- 2026-06-${String(i + 1).padStart(2, '0')}: e${i + 1}`)
    const doc = ds.readDoc(r.abs).content.replace(heading + '\n', heading + '\n' + entries.join('\n') + '\n')
    ds.writeDoc(r.abs, doc)
    const rolled = rotateContextDocOnDisk(ds, r.abs, { maxLines: 40, keep: 15, locale: 'zh-CN' })
    expect(rolled).toBe(true)
    expect(existsSync(archivePathFor(r.abs))).toBe(true)
    expect(ds.readDoc(r.abs).content).toContain('更早进展见')
    expect(ds.readDoc(archivePathFor(r.abs)).content).toContain('- 2026-06-01: e1')
  })

  it('rotateContextDocOnDisk is a safe no-op when under threshold', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    expect(rotateContextDocOnDisk(ds, r.abs, { maxLines: 40, keep: 15, locale: 'zh-CN' })).toBe(false)
    expect(existsSync(archivePathFor(r.abs))).toBe(false)
  })

  it('appendContextLogOnDisk appends a dated entry into the live doc', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    const out = appendContextLogOnDisk(ds, r.abs, { text: '完成了登录', date: '2026-06-15', maxLines: 40, keep: 15, locale: 'zh-CN' })
    expect(out.appended).toBe(true)
    expect(out.rotated).toBe(false)
    expect(ds.readDoc(r.abs).content).toContain('- 2026-06-15: 完成了登录')
  })

  it('appendContextLogOnDisk rolls when the append pushes over the threshold', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    const heading = contextStrings('zh-CN').logHeading
    const seed = Array.from({ length: 40 }, (_, i) => `- 2026-06-${String(i + 1).padStart(2, '0')}: e${i + 1}`)
    const doc = ds.readDoc(r.abs).content.replace(heading + '\n', heading + '\n' + seed.join('\n') + '\n')
    ds.writeDoc(r.abs, doc)
    const out = appendContextLogOnDisk(ds, r.abs, { text: 'overflow', date: '2026-07-01', maxLines: 40, keep: 15, locale: 'zh-CN' })
    expect(out.appended).toBe(true)
    expect(out.rotated).toBe(true)
    expect(existsSync(archivePathFor(r.abs))).toBe(true)
    expect(ds.readDoc(r.abs).content).toContain('- 2026-07-01: overflow')
  })

  it('appendContextLogOnDisk no-ops on a missing file', () => {
    const ds = new DocStore(tmpRoot())
    const out = appendContextLogOnDisk(ds, join(ds.root, 'tasks/none/index.md'), { text: 'x', date: '2026-06-15', maxLines: 40, keep: 15, locale: 'zh-CN' })
    expect(out.appended).toBe(false)
  })

  it('compactContextDocOnDisk splits an oversized context doc into a main doc plus a reference child', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'project', 'Berth', { title: 'Berth', projectName: 'Berth', locale: 'zh-CN' })
    const huge = [
      '# Berth — 项目上下文',
      '',
      '## 目标 / 为什么',
      '目标 '.repeat(500),
      '',
      '## 背景 / 约束 / 关键决策',
      '背景 '.repeat(500),
      '',
      '## 进展日志',
      ...Array.from({ length: 20 }, (_, i) => `- 2026-06-${String(i + 1).padStart(2, '0')}: 进展 ${i + 1}`),
      '',
    ].join('\n')
    ds.writeDoc(r.abs, huge)

    const compacted = compactContextDocOnDisk(ds, r.abs, { maxChars: 800, keepChars: 500, logKeep: 3, locale: 'zh-CN', date: '2026-06-24' })

    expect(compacted).toBe(true)
    const main = ds.readDoc(r.abs).content
    expect(main).toContain('## 参考子文档')
    expect(main).toContain('references/context-2026-06-24.md')
    expect(main.length).toBeLessThan(huge.length)
    const refs = readdirSync(join(ds.root, 'projects/Berth/references'))
    expect(refs).toEqual(['context-2026-06-24.md'])
    const ref = ds.readDoc(join(ds.root, 'projects/Berth/references/context-2026-06-24.md')).content
    expect(ref).toContain('## 摘要')
    expect(ref).toContain('## 拆分前完整上下文')
    expect(ref).toContain('背景 '.repeat(20).trim())
  })

  it('maintainContextDocOnDisk reports both log rotation and document compaction', () => {
    const ds = new DocStore(tmpRoot())
    const r = ensureContextDoc(ds, 'task', 'abc', { title: 't', projectName: 'P', locale: 'zh-CN' })
    const heading = contextStrings('zh-CN').logHeading
    const entries = Array.from({ length: 6 }, (_, i) => `- 2026-06-${String(i + 1).padStart(2, '0')}: ${'very long progress '.repeat(30)}${i + 1}`)
    const doc = ds.readDoc(r.abs).content.replace(heading + '\n', heading + '\n' + entries.join('\n') + '\n')
    ds.writeDoc(r.abs, doc)

    const out = maintainContextDocOnDisk(ds, r.abs, {
      logMaxLines: 3, logKeep: 2, docMaxChars: 500, docKeepChars: 350, locale: 'zh-CN', date: '2026-06-24',
    })

    expect(out.rotated).toBe(true)
    expect(out.compacted).toBe(true)
    expect(existsSync(archivePathFor(r.abs))).toBe(true)
    expect(existsSync(join(ds.root, 'tasks/abc/references/context-2026-06-24.md'))).toBe(true)
  })
})
