import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocsRootMigrationConflict, migrateDocsRoot, normalizeDocsRoot } from '../src/data/docs-root-migration'

function tmpRoot(name: string) {
  return mkdtempSync(join(tmpdir(), name))
}

function store(root: string) {
  const settings = new Map<string, string>([['docsRoot', root]])
  return {
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: string) => { settings.set(key, value) },
  }
}

describe('docsRoot migration', () => {
  it('copies only Berth-managed docs and switches the setting after success', () => {
    const oldRoot = tmpRoot('berth-docs-old-')
    const newRoot = tmpRoot('berth-docs-new-')
    rmSync(newRoot, { recursive: true, force: true })
    mkdirSync(join(oldRoot, 'tasks/t1/assets'), { recursive: true })
    mkdirSync(join(oldRoot, 'projects/Berth'), { recursive: true })
    writeFileSync(join(oldRoot, 'tasks/t1/index.md'), '# task')
    writeFileSync(join(oldRoot, 'tasks/t1/assets/a.png'), 'png')
    writeFileSync(join(oldRoot, 'projects/Berth/index.md'), '# project')
    writeFileSync(join(oldRoot, 'AGENTS.md'), '# protocol')
    writeFileSync(join(oldRoot, 'personal.md'), '# unrelated')
    mkdirSync(join(oldRoot, 'assets'), { recursive: true })
    writeFileSync(join(oldRoot, 'assets/personal.png'), 'personal')

    const s = store(oldRoot)
    const result = migrateDocsRoot(s, newRoot)

    expect(result.changed).toBe(true)
    expect(result.copied).toBe(4)
    expect(s.getSetting('docsRoot')).toBe(normalizeDocsRoot(newRoot))
    expect(readFileSync(join(newRoot, 'tasks/t1/index.md'), 'utf8')).toBe('# task')
    expect(readFileSync(join(newRoot, 'projects/Berth/index.md'), 'utf8')).toBe('# project')
    expect(readFileSync(join(newRoot, 'AGENTS.md'), 'utf8')).toBe('# protocol')
    expect(existsSync(join(newRoot, 'personal.md'))).toBe(false)
    expect(existsSync(join(newRoot, 'assets/personal.png'))).toBe(false)
  })

  it('copies legacy root assets only when a managed markdown file references them', () => {
    const oldRoot = tmpRoot('berth-docs-old-')
    const newRoot = tmpRoot('berth-docs-new-')
    rmSync(newRoot, { recursive: true, force: true })
    mkdirSync(join(oldRoot, 'tasks/t1'), { recursive: true })
    mkdirSync(join(oldRoot, 'assets'), { recursive: true })
    writeFileSync(join(oldRoot, 'tasks/t1/index.md'), '# task\n\n![](assets/used.png)\n')
    writeFileSync(join(oldRoot, 'assets/used.png'), 'used')
    writeFileSync(join(oldRoot, 'assets/unrelated.png'), 'unrelated')

    const result = migrateDocsRoot(store(oldRoot), newRoot)

    expect(result.copied).toBe(2)
    expect(readFileSync(join(newRoot, 'tasks/t1/assets/used.png'), 'utf8')).toBe('used')
    expect(existsSync(join(newRoot, 'assets/unrelated.png'))).toBe(false)
  })

  it('refuses to switch when a destination file has different content', () => {
    const oldRoot = tmpRoot('berth-docs-old-')
    const newRoot = tmpRoot('berth-docs-new-')
    mkdirSync(join(oldRoot, 'projects/Berth'), { recursive: true })
    mkdirSync(join(newRoot, 'projects/Berth'), { recursive: true })
    writeFileSync(join(oldRoot, 'projects/Berth/index.md'), '# old')
    writeFileSync(join(newRoot, 'projects/Berth/index.md'), '# new')
    const s = store(oldRoot)

    expect(() => migrateDocsRoot(s, newRoot)).toThrow(DocsRootMigrationConflict)
    expect(s.getSetting('docsRoot')).toBe(oldRoot)
  })

  it('treats identical existing destination files as unchanged', () => {
    const oldRoot = tmpRoot('berth-docs-old-')
    const newRoot = tmpRoot('berth-docs-new-')
    mkdirSync(join(oldRoot, 'projects/Berth'), { recursive: true })
    mkdirSync(join(newRoot, 'projects/Berth'), { recursive: true })
    writeFileSync(join(oldRoot, 'projects/Berth/index.md'), '# same')
    writeFileSync(join(newRoot, 'projects/Berth/index.md'), '# same')
    const result = migrateDocsRoot(store(oldRoot), newRoot)

    expect(result.copied).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(result.conflicts).toEqual([])
  })
})
