import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DocStore, getDocsRoot, DEFAULT_DOCS_ROOT } from '../src/data/docstore'
import { setDocGitEnabled, __resetDocGit } from '../src/data/doc-git'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-docstore-')) }

describe('DocStore', () => {
  it('resolves an obsidian-wrapped ref to a .md inside the root', () => {
    const root = tmpRoot()
    const ds = new DocStore(root)
    const ref = '[obsidian://open?vault=V&file=projects%2F20260611N-x](http://obsidian://open?vault=V&file=projects%2F20260611N-x)'
    expect(ds.resolveDocPath(ref)).toBe(join(root, 'projects/20260611N-x.md'))
  })

  it('resolves a root-relative path and adds .md', () => {
    const root = tmpRoot()
    const ds = new DocStore(root)
    expect(ds.resolveDocPath('tasks/abc/index')).toBe(join(root, 'tasks/abc/index.md'))
  })

  it('rejects path traversal out of the root', () => {
    const ds = new DocStore(tmpRoot())
    expect(ds.resolveDocPath('obsidian://open?file=..%2F..%2F..%2Fetc%2Fpasswd')).toBeNull()
    expect(ds.resolveDocPath('/etc/passwd.md')).toBeNull()
    expect(ds.resolveDocPath('projects/foo.txt')).toBeNull()
    expect(ds.resolveDocPath('')).toBeNull()
  })

  it('writeDoc creates parent dirs and readDoc returns content + mtime', () => {
    const root = tmpRoot()
    const ds = new DocStore(root)
    const abs = ds.resolveDocPath(ds.taskDocRef('u1'))!
    expect(abs).toBe(join(root, 'tasks/u1/index.md'))
    const { mtime } = ds.writeDoc(abs, '# hi')
    expect(existsSync(abs)).toBe(true)
    expect(typeof mtime).toBe('number')
    expect(ds.readDoc(abs).content).toBe('# hi')
  })

  it('saveAttachment writes under <root>/assets and returns a root-relative ref', () => {
    const root = tmpRoot()
    const ds = new DocStore(root)
    const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64')
    const saved = ds.saveAttachment(png, 'task')!
    expect(saved.rel.startsWith('assets/')).toBe(true)
    expect(saved.abs.startsWith(join(root, 'assets'))).toBe(true)
    expect(existsSync(saved.abs)).toBe(true)
    // the saved asset is resolvable + confined to root
    expect(ds.resolveAssetPath(saved.rel)).toBe(saved.abs)
  })

  it('saveAttachment co-locates under <destDir>/assets and returns a note-relative ref', () => {
    const root = tmpRoot()
    const ds = new DocStore(root)
    const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64')
    const saved = ds.saveAttachment(png, 'task', 'tasks/u1')!
    // physically next to the note (tasks/u1/index.md), ref relative to that note
    expect(saved.abs.startsWith(join(root, 'tasks/u1/assets'))).toBe(true)
    expect(saved.rel.startsWith('assets/')).toBe(true)
    expect(existsSync(saved.abs)).toBe(true)
    // the ref resolves correctly from the note's own directory
    expect(ds.resolveAssetPath(join('tasks/u1', saved.rel))).toBe(saved.abs)
  })

  it('saveAttachment refuses a destDir that escapes the root', () => {
    const ds = new DocStore(tmpRoot())
    const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64')
    expect(ds.saveAttachment(png, 'task', '../evil')).toBeNull()
  })

  it('layout ref helpers', () => {
    const ds = new DocStore('/r')
    expect(ds.taskDocRef('u1')).toBe('tasks/u1/index.md')
    expect(ds.projectDocRef('Berth')).toBe('projects/Berth/index.md')
  })

  it('getDocsRoot falls back to the default when unset', () => {
    const store = { getSetting: (_k: string) => null }
    expect(getDocsRoot(store)).toBe(DEFAULT_DOCS_ROOT)
    const store2 = { getSetting: (_k: string) => '/custom/root' }
    expect(getDocsRoot(store2)).toBe('/custom/root')
  })
})

describe('writeDoc + git', () => {
  it('commits the written file when git is enabled, with a default message', () => {
    __resetDocGit(); setDocGitEnabled(true)
    const root = mkdtempSync(join(tmpdir(), 'berth-ds-'))
    const ds = new DocStore(root)
    const abs = join(root, 'tasks', 't1', 'index.md')
    ds.writeDoc(abs, '# hi')
    const subjects = execFileSync('git', ['log', '--pretty=%s'], { cwd: root }).toString()
    expect(subjects).toContain('docs: update tasks/t1/index.md')
    setDocGitEnabled(false)                              // reset so later tests don't spawn git
  })

  it('does NOT touch git when disabled (default)', () => {
    __resetDocGit()                                     // leaves gitEnabled = false
    const root = mkdtempSync(join(tmpdir(), 'berth-ds2-'))
    new DocStore(root).writeDoc(join(root, 'a.md'), 'x')
    expect(existsSync(join(root, '.git'))).toBe(false)
  })
})
