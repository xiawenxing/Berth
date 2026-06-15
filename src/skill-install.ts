import { existsSync, mkdirSync, readdirSync, statSync, lstatSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

/**
 * Locate the bundled `skills/` dir by walking up from `startDir` (mirrors resolvePublicDir). Robust
 * to dev (src/cli.ts → repo root) and packaged (dist/cli.js → package root) layouts.
 */
export function resolveSkillsDir(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'skills')
    if (existsSync(join(candidate, 'berth-tasks', 'SKILL.md'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function pathExists(p: string): boolean {
  try { lstatSync(p); return true } catch { return false }   // lstat so broken symlinks count as present
}

/** Names of bundled skills (dirs containing a SKILL.md). */
export function bundledSkillNames(skillsDir: string): string[] {
  return readdirSync(skillsDir).filter(n => {
    const p = join(skillsDir, n)
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'))
  })
}

/**
 * Agents that use the per-agent `~/.<agent>/skills/<name>/SKILL.md` convention (same format Berth
 * ships). Used by the no-`skills`-CLI fallback. The real installer (`skills` CLI) covers more agents
 * and is preferred; this is just so a bare CLI install still wires up the agents the user actually has.
 */
export const AGENT_SKILL_DIRS: { agent: string; rel: string; marker: string }[] = [
  { agent: 'Claude Code', rel: '.claude/skills', marker: '.claude' },
  { agent: 'Codex', rel: '.codex/skills', marker: '.codex' },
  { agent: 'Cursor', rel: '.cursor/skills', marker: '.cursor' },
  { agent: 'Gemini', rel: '.gemini/skills', marker: '.gemini' },
  { agent: 'Coco', rel: '.coco/skills', marker: '.coco' },
]

export interface AgentTarget { agent: string; dir: string }

/** Agents present on this machine (their home marker dir exists), with their skills dest dir. */
export function detectAgentSkillDirs(home = homedir()): AgentTarget[] {
  return AGENT_SKILL_DIRS
    .filter(a => existsSync(join(home, a.marker)))
    .map(a => ({ agent: a.agent, dir: join(home, a.rel) }))
}

export interface InstallResult { agent: string; installed: string[]; skipped: string[] }

/**
 * Fallback installer (used only when the cross-agent `skills` CLI is unavailable): **symlink** each
 * bundled skill into each agent target's skills dir. Symlinks (not copies) so the agents always read
 * the package's current skill and a `berth` upgrade is reflected everywhere with no re-install.
 * Skips an existing entry unless `force` (which replaces it).
 */
export function linkBundledSkills(skillsDir: string, targets: AgentTarget[], force = false): InstallResult[] {
  const names = bundledSkillNames(skillsDir)
  return targets.map(t => {
    mkdirSync(t.dir, { recursive: true })
    const installed: string[] = [], skipped: string[] = []
    for (const name of names) {
      const dest = join(t.dir, name)
      if (pathExists(dest)) {
        if (!force) { skipped.push(name); continue }
        rmSync(dest, { recursive: true, force: true })
      }
      symlinkSync(join(skillsDir, name), dest, 'dir')
      installed.push(name)
    }
    return { agent: t.agent, installed, skipped }
  })
}
