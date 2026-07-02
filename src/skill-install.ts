import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, lstatSync, rmSync, symlinkSync, readFileSync, realpathSync } from 'node:fs'
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
  // `skills add -g` installs universal skills in ~/.agents/skills, which is the Codex global skill
  // location. Checking ~/.codex/skills would report false missing after a successful install.
  { agent: 'Codex', rel: '.agents/skills', marker: '.codex' },
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
export interface SkillsCliInstallResult { ok: boolean; installed: string[]; error: string | null }
export interface BundledSkillInstallResult { skillsCli: SkillsCliInstallResult; fallback: InstallResult[] }

function sameRealPath(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

function sameSkillContent(installedSkillPath: string, bundledSkillPath: string): boolean {
  try {
    return readFileSync(join(installedSkillPath, 'SKILL.md'), 'utf8') === readFileSync(join(bundledSkillPath, 'SKILL.md'), 'utf8')
  } catch {
    return false
  }
}

export function bundledSkillState(dest: string, bundledSkillPath: string): 'current' | 'missing' | 'outdated' {
  if (!existsSync(dest)) return 'missing'
  return sameRealPath(dest, bundledSkillPath) || sameSkillContent(dest, bundledSkillPath) ? 'current' : 'outdated'
}

function execFileExit(cmd: string, args: string[], timeout = 120_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      const code = typeof (error as any)?.code === 'number' ? (error as any).code : error ? -1 : 0
      resolve({ code, output: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    })
  })
}

export async function installWithSkillsCli(skillsDir: string): Promise<SkillsCliInstallResult> {
  if (process.env.BERTH_SKIP_SKILLS_CLI === '1') {
    return { ok: false, installed: [], error: 'disabled by BERTH_SKIP_SKILLS_CLI' }
  }
  const names = bundledSkillNames(skillsDir)
  const installed: string[] = []
  for (const name of names) {
    const result = await execFileExit('npx', ['--yes', 'skills', 'add', join(skillsDir, name), '-g', '-y', '--agent', '*'])
    if (result.code !== 0) return { ok: false, installed, error: result.output || '`npx skills add` failed' }
    installed.push(name)
  }
  return { ok: true, installed, error: null }
}

export async function installBundledSkills(skillsDir: string, targets: AgentTarget[], force = false): Promise<BundledSkillInstallResult> {
  const skillsCli = await installWithSkillsCli(skillsDir)
  const names = bundledSkillNames(skillsDir)
  const fallbackTargets = targets.filter((target) =>
    names.some((name) => bundledSkillState(join(target.dir, name), join(skillsDir, name)) !== 'current')
  )
  return {
    skillsCli,
    fallback: fallbackTargets.length > 0 ? linkBundledSkills(skillsDir, fallbackTargets, force) : [],
  }
}

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
