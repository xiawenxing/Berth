import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { migrateAttachmentsOnce } from '../src/data/migrate-assets'
import type { Task } from '../src/data/types'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-mig-assets-')) }

function task(id: string, detailDoc: string | null): Task {
  return { id, title: id, status: '待办', priority: 'P1', project: null, projectId: null,
    detailDoc, progress: null, updatedAt: 1, syncedAt: 0, deleted: false } as any
}

describe('migrateAttachmentsOnce', () => {
  it('copies an orphaned root-assets image next to its task note', () => {
    const root = tmpRoot()
    // old broken state: file lives at <root>/assets, note embeds the note-relative ref
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'assets', 'task-1-2.png'), 'PNGDATA')
    mkdirSync(join(root, 'tasks', 'u1'), { recursive: true })
    writeFileSync(join(root, 'tasks', 'u1', 'index.md'), '# t\n\n![](assets/task-1-2.png)\n')

    const store = openStore(':memory:')
    store.insertTask(task('u1', 'tasks/u1/index.md'))

    const n = migrateAttachmentsOnce(store, { docsRoot: root })
    expect(n).toBe(1)
    // copied into place …
    expect(existsSync(join(root, 'tasks', 'u1', 'assets', 'task-1-2.png'))).toBe(true)
    // … and the original is left untouched (shared vault dir — copy-only)
    expect(existsSync(join(root, 'assets', 'task-1-2.png'))).toBe(true)
    expect(store.getSetting('assets-migrated')).toBe('1')
  })

  it('is idempotent and guarded (second run copies nothing)', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'assets', 'task-9-9.png'), 'X')
    mkdirSync(join(root, 'tasks', 'u1'), { recursive: true })
    writeFileSync(join(root, 'tasks', 'u1', 'index.md'), '![](assets/task-9-9.png)')
    const store = openStore(':memory:')
    store.insertTask(task('u1', 'tasks/u1/index.md'))

    expect(migrateAttachmentsOnce(store, { docsRoot: root })).toBe(1)
    // guard flag set → no-op on re-run even after deleting the placed copy is irrelevant
    expect(migrateAttachmentsOnce(store, { docsRoot: root })).toBe(0)
  })

  it('skips images that already resolve, external URLs, and missing sources', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'tasks', 'u1', 'assets'), { recursive: true })
    writeFileSync(join(root, 'tasks', 'u1', 'assets', 'ok.png'), 'OK')   // already in place
    writeFileSync(join(root, 'tasks', 'u1', 'index.md'),
      '![](assets/ok.png)\n![](https://x/y.png)\n![](assets/nope.png)\n')
    const store = openStore(':memory:')
    store.insertTask(task('u1', 'tasks/u1/index.md'))
    // ok.png already there; https skipped; nope.png has no source at <root>/assets → nothing copied
    expect(migrateAttachmentsOnce(store, { docsRoot: root })).toBe(0)
  })
})
