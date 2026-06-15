import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSkillsDir, linkBundledSkills, detectAgentSkillDirs, bundledSkillNames } from '../src/skill-install'

describe('resolveSkillsDir', () => {
  it('finds the repo skills/ dir from a nested start dir', () => {
    // src/ is a nested dir of the repo; resolver should walk up to the real skills/berth-tasks.
    const dir = resolveSkillsDir(join(process.cwd(), 'src', 'data'))
    expect(dir).toBe(join(process.cwd(), 'skills'))
    expect(existsSync(join(dir!, 'berth-tasks', 'SKILL.md'))).toBe(true)
  })
  it('returns null when no skills/ is above the start dir', () => {
    expect(resolveSkillsDir(mkdtempSync(join(tmpdir(), 'noskills-')))).toBeNull()
  })
})

function fakeSkillsDir() {
  const root = mkdtempSync(join(tmpdir(), 'berth-skills-'))
  mkdirSync(join(root, 'berth-tasks', 'references'), { recursive: true })
  writeFileSync(join(root, 'berth-tasks', 'SKILL.md'), '# berth-tasks')
  writeFileSync(join(root, 'berth-tasks', 'references', 'note.md'), 'ref')
  return root
}

describe('bundledSkillNames', () => {
  it('lists dirs that contain a SKILL.md', () => {
    expect(bundledSkillNames(fakeSkillsDir())).toEqual(['berth-tasks'])
  })
})

describe('detectAgentSkillDirs', () => {
  it('returns only agents whose home marker dir exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'berth-home-'))
    mkdirSync(join(home, '.claude'), { recursive: true })
    mkdirSync(join(home, '.codex'), { recursive: true })
    const agents = detectAgentSkillDirs(home)
    expect(agents.map(a => a.agent).sort()).toEqual(['Claude Code', 'Codex'])
    expect(agents.find(a => a.agent === 'Codex')!.dir).toBe(join(home, '.codex', 'skills'))
  })
})

describe('linkBundledSkills (symlink fallback)', () => {
  it('symlinks each skill into every agent target; skips existing without --force, replaces with force', () => {
    const src = fakeSkillsDir()
    const home = mkdtempSync(join(tmpdir(), 'berth-home-'))
    const targets = [
      { agent: 'Claude Code', dir: join(home, '.claude', 'skills') },
      { agent: 'Codex', dir: join(home, '.codex', 'skills') },
    ]

    const r1 = linkBundledSkills(src, targets, false)
    expect(r1.map(r => r.agent)).toEqual(['Claude Code', 'Codex'])
    expect(r1[0].installed).toEqual(['berth-tasks'])
    const link = join(home, '.claude', 'skills', 'berth-tasks')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    // resolves through the symlink to the bundled content
    expect(readFileSync(join(link, 'SKILL.md'), 'utf8')).toBe('# berth-tasks')
    expect(existsSync(join(home, '.codex', 'skills', 'berth-tasks', 'references', 'note.md'))).toBe(true)

    const r2 = linkBundledSkills(src, targets, false)
    expect(r2.every(r => r.installed.length === 0 && r.skipped.length === 1)).toBe(true)

    const r3 = linkBundledSkills(src, targets, true)
    expect(r3.every(r => r.installed.length === 1)).toBe(true)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })
})
