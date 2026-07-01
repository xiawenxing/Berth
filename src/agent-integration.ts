import { execFileSync } from 'node:child_process'
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectAgentSkillDirs, linkBundledSkills, resolveSkillsDir, type InstallResult } from './skill-install'

const MANAGED_MARKER = 'BERTH_MANAGED_CLI_SHIM'

export type IntegrationState = 'current' | 'missing' | 'outdated'

export interface CliIntegrationStatus {
  state: IntegrationState
  currentVersion: string
  installedVersion: string | null
  path: string
  pathInEnv: boolean
  managed: boolean
}

export interface SkillTargetStatus {
  agent: string
  dir: string
  state: IntegrationState
}

export interface SkillIntegrationStatus {
  state: IntegrationState
  bundled: boolean
  targets: SkillTargetStatus[]
}

export interface AgentIntegrationStatus {
  currentVersion: string
  cli: CliIntegrationStatus
  skills: SkillIntegrationStatus
  needsAction: boolean
}

export interface AgentIntegrationInstallResult {
  status: AgentIntegrationStatus
  cliPath: string
  skillResults: InstallResult[]
}

function packageRoot(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'bin', 'berth.mjs'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not locate Berth package root')
}

function currentVersion(root = packageRoot()): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function cliEntry(root = packageRoot()): string {
  return join(root, 'bin', 'berth.mjs')
}

function userCliPath(home = homedir()): string {
  return join(home, '.local', 'bin', 'berth')
}

function isInPath(binPath: string, envPath = process.env.PATH ?? ''): boolean {
  const dir = dirname(binPath)
  return envPath.split(delimiter).some(p => p && resolve(p) === resolve(dir))
}

function isExecutable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true } catch { return false }
}

function pathBerthCandidates(envPath = process.env.PATH ?? ''): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue
    const p = join(dir, 'berth')
    const key = resolve(p)
    if (seen.has(key) || !isExecutable(p)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function readManagedVersion(path: string): string | null {
  try {
    const body = readFileSync(path, 'utf8')
    const m = body.match(/BERTH_MANAGED_CLI_SHIM version=([^\s]+)/)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

function probeCliVersion(path: string): string | null {
  try {
    const out = execFileSync(path, ['--version'], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? '1' },
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function inspectCli(path: string): Pick<CliIntegrationStatus, 'installedVersion' | 'managed'> & { path: string } {
  const managedVersion = readManagedVersion(path)
  return { path, managed: Boolean(managedVersion), installedVersion: managedVersion ?? probeCliVersion(path) }
}

function cliStatus(version = currentVersion(), home = homedir()): CliIntegrationStatus {
  const defaultPath = userCliPath(home)
  const candidates = [
    ...(isExecutable(defaultPath) ? [defaultPath] : []),
    ...pathBerthCandidates(),
  ]
  const unique = [...new Map(candidates.map(p => [resolve(p), p])).values()]
  const inspected = unique.map(inspectCli)
  const current = inspected.find(c => c.installedVersion === version)
  const selected = current ?? inspected[0] ?? { path: defaultPath, managed: false, installedVersion: null }
  return {
    state: selected.installedVersion === version ? 'current' : selected.installedVersion ? 'outdated' : 'missing',
    currentVersion: version,
    installedVersion: selected.installedVersion,
    path: selected.path,
    pathInEnv: isInPath(selected.path),
    managed: selected.managed,
  }
}

function sameRealPath(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

function skillTargetState(dir: string, bundledSkillPath: string): IntegrationState {
  const dest = join(dir, 'berth-tasks')
  if (!existsSync(dest)) return 'missing'
  return sameRealPath(dest, bundledSkillPath) ? 'current' : 'outdated'
}

function skillsStatus(): SkillIntegrationStatus {
  const dir = resolveSkillsDir(dirname(fileURLToPath(import.meta.url)))
  if (!dir) return { state: 'missing', bundled: false, targets: [] }
  const bundledSkillPath = join(dir, 'berth-tasks')
  const targets = detectAgentSkillDirs().map(t => ({
    agent: t.agent,
    dir: t.dir,
    state: skillTargetState(t.dir, bundledSkillPath),
  }))
  const state: IntegrationState = targets.some(t => t.state === 'outdated')
    ? 'outdated'
    : targets.some(t => t.state === 'missing')
      ? 'missing'
      : 'current'
  return { state, bundled: true, targets }
}

export function getAgentIntegrationStatus(): AgentIntegrationStatus {
  const version = currentVersion()
  const cli = cliStatus(version)
  const skills = skillsStatus()
  return {
    currentVersion: version,
    cli,
    skills,
    needsAction: cli.state !== 'current' || skills.state !== 'current',
  }
}

function cliShimBody(entry: string, version: string): string {
  return [
    '#!/bin/sh',
    `# ${MANAGED_MARKER} version=${version}`,
    '# Auto-generated by Berth. Re-run Settings -> Agent integration after moving or upgrading Berth.',
    `ELECTRON_RUN_AS_NODE=1 exec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} "$@"`,
    '',
  ].join('\n')
}

function installCliShim(version = currentVersion()): string {
  const path = userCliPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, cliShimBody(cliEntry(), version))
  chmodSync(path, 0o755)
  return path
}

function replaceBrokenSkillSymlink(path: string) {
  try {
    if (lstatSync(path).isSymbolicLink()) rmSync(path, { force: true })
  } catch {
    // lstat failed: path does not exist, or is otherwise not removable here.
  }
}

export function installAgentIntegration(): AgentIntegrationInstallResult {
  const version = currentVersion()
  const cliPath = installCliShim(version)
  const skillsDir = resolveSkillsDir(dirname(fileURLToPath(import.meta.url)))
  if (!skillsDir) throw new Error('could not locate bundled skills/berth-tasks')
  const targets = detectAgentSkillDirs()
  for (const target of targets) replaceBrokenSkillSymlink(join(target.dir, 'berth-tasks'))
  const skillResults = linkBundledSkills(skillsDir, targets, true)
  return { cliPath, skillResults, status: getAgentIntegrationStatus() }
}
