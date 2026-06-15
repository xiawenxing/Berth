// src/data/doc-git.ts
// Git layer for Berth's doc store: keep every context-doc write under version control so any
// agent edit is revertable. Hung off DocStore.writeDoc. The enable flag defaults OFF so the test
// suite never spawns git; server boot turns it on from config (contextGitEnabled, default true).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'

// A stable identity so commits succeed even on machines with no global git user configured.
const IDENT = ['-c', 'user.name=Berth', '-c', 'user.email=berth@localhost']

let gitEnabled = false
export function setDocGitEnabled(v: boolean): void { gitEnabled = v }
export function isDocGitEnabled(): boolean { return gitEnabled }

let gitAvailable: boolean | null = null
export function hasGit(): boolean {
  if (gitAvailable !== null) return gitAvailable
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); gitAvailable = true } catch { gitAvailable = false }
  return gitAvailable
}

/** Test seam: clear cached git-availability and reset the enable flag to its default. */
export function __resetDocGit(): void { gitAvailable = null; gitEnabled = false }

export interface GitResult { ok: boolean; reason?: string }

function run(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
}

const ensured = new Set<string>()
/** Ensure `root` is a git repo. Inits + makes an initial commit if not. Idempotent. */
export function ensureRepo(root: string): GitResult {
  if (existsSync(join(root, '.git'))) { ensured.add(root); return { ok: true } }
  if (!hasGit()) return { ok: false, reason: 'git-not-installed' }
  try {
    run(root, ['init'])
    run(root, ['add', '-A'])                                  // only ever runs on a brand-new root
    run(root, [...IDENT, 'commit', '--allow-empty', '-m', 'chore(berth): initialize docs repo', '--no-verify'])
    ensured.add(root)
    return { ok: true }
  } catch (e: any) { return { ok: false, reason: String(e?.message ?? e) } }
}

/** Stage and commit ONLY `fileAbs`. No-op (reason:'no-change') when the file has no pending change. */
export function commitDoc(root: string, fileAbs: string, message: string): GitResult {
  if (!gitEnabled) return { ok: false, reason: 'disabled' }
  const ready = ensureRepo(root)
  if (!ready.ok) return ready
  const rel = isAbsolute(fileAbs) ? relative(root, fileAbs) : fileAbs
  try {
    run(root, ['add', '--', rel])
    const staged = run(root, ['diff', '--cached', '--name-only', '--', rel]).trim()
    if (!staged) return { ok: true, reason: 'no-change' }
    run(root, [...IDENT, 'commit', '-m', message, '--no-verify', '--', rel])  // pathspec → only this file
    return { ok: true }
  } catch (e: any) { return { ok: false, reason: String(e?.message ?? e) } }
}

/** Current HEAD sha, or null if unavailable. */
export function headCommit(root: string): string | null {
  try { return run(root, ['rev-parse', 'HEAD']).trim() || null } catch { return null }
}

/** Revert a commit by sha (validated). Used by the "回滚此次" UI. */
export function revertCommit(root: string, commit: string): GitResult {
  if (!/^[0-9a-fA-F]{7,40}$/.test(commit)) return { ok: false, reason: 'invalid commit' }
  try { run(root, [...IDENT, 'revert', '--no-edit', commit]); return { ok: true } }
  catch (e: any) { return { ok: false, reason: String(e?.message ?? e) } }
}
