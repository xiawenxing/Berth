// test/doc-git.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureRepo, commitDoc, revertCommit, headCommit, hasGit, setDocGitEnabled, __resetDocGit } from '../src/data/doc-git'

function gitLog(root: string): string[] {
  return execFileSync('git', ['log', '--pretty=%s'], { cwd: root }).toString().trim().split('\n').filter(Boolean)
}
function filesInHead(root: string): string[] {
  return execFileSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: root }).toString().trim().split('\n').filter(Boolean)
}

describe('doc-git', () => {
  let root: string
  beforeEach(() => { __resetDocGit(); setDocGitEnabled(true); root = mkdtempSync(join(tmpdir(), 'berth-git-')) })

  it('ensureRepo inits a non-repo, idempotent on a repo', () => {
    expect(existsSync(join(root, '.git'))).toBe(false)
    expect(ensureRepo(root).ok).toBe(true)
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(ensureRepo(root).ok).toBe(true) // second call is a no-op
  })

  it('commitDoc commits ONLY the named file, skips when unchanged', () => {
    ensureRepo(root)
    writeFileSync(join(root, 'a.md'), 'hello')
    writeFileSync(join(root, 'b.md'), 'untracked sibling')
    expect(commitDoc(root, join(root, 'a.md'), 'docs: a').ok).toBe(true)
    expect(filesInHead(root)).toEqual(['a.md'])          // b.md NOT swept in
    expect(commitDoc(root, join(root, 'a.md'), 'docs: a again').reason).toBe('no-change')
  })

  it('revertCommit undoes the last change to a file', () => {
    ensureRepo(root)
    writeFileSync(join(root, 'a.md'), 'v1'); commitDoc(root, join(root, 'a.md'), 'v1')
    writeFileSync(root + '/a.md', 'v2'); commitDoc(root, join(root, 'a.md'), 'v2')
    const bad = headCommit(root)!
    expect(revertCommit(root, bad).ok).toBe(true)
    expect(execFileSync('git', ['show', 'HEAD:a.md'], { cwd: root }).toString()).toBe('v1')
  })

  it('honors the enable flag', () => {
    setDocGitEnabled(false)
    ensureRepo(root)
    writeFileSync(join(root, 'a.md'), 'x')
    expect(commitDoc(root, join(root, 'a.md'), 'nope').reason).toBe('disabled')
  })
})
