import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocStore } from '../src/data/docstore'
import { ensureContextDoc, archivePathFor, rotateContextDocOnDisk, appendContextLogOnDisk } from '../src/data/context-doc'
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
})
