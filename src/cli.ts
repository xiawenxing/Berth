import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { formatStartupError } from './startup-error'

export interface CliArgs {
  command: 'start' | 'help' | 'version'
  port: number | undefined
  host: string | undefined
  open: boolean
}

/**
 * Pure argv parser for the `berth` CLI. Side-effect-free so it can be unit-tested; the runner below
 * consumes the result. Accepts: `berth [start] [--port N] [--host H] [--open|--no-open]`,
 * `berth --help|-h`, `berth --version`.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: 'start', port: undefined, host: undefined, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h' || a === 'help') out.command = 'help'
    else if (a === '--version' || a === '-v' || a === 'version') out.command = 'version'
    else if (a === 'start') out.command = 'start'
    else if (a === '--open') out.open = true
    else if (a === '--no-open') out.open = false
    else if (a === '--port') {
      const v = Number(argv[++i])
      if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`invalid --port: ${argv[i]}`)
      out.port = v
    } else if (a === '--host') {
      out.host = argv[++i]
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return out
}

const HELP = `berth — agent-session cockpit

Usage:
  berth start [options]   Start the local server and open the UI in your browser
  berth task ...          Manage tasks (list/add/done/status/set/log/doc/rm/sync) — needs a running server
  berth project ...       Manage projects (list/add/rename/archive/rm) — needs a running server
  berth skill install     Install the bundled Berth skill into your agents (use --force to overwrite)
  berth --help            Show this help
  berth --version         Show the version

Options:
  --port <n>     Port to listen on (default 7777, or $PORT)
  --host <h>     Host to bind (default 127.0.0.1; use 0.0.0.0 to expose on your LAN — unsafe)
  --no-open      Do not open the browser automatically

State lives in ~/.berth (sqlite + docs). The server is single-user and unauthenticated; keep it on
loopback. See the README for optional integrations (e.g. Feishu).`

/** Best-effort cross-platform browser open. Never throws (a failed open must not crash the server). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref() } catch { /* ignore */ }
}

function spawnExit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('close', c => resolve(c ?? 0)); p.on('error', () => resolve(-1))
  })
}

/**
 * Install the bundled Berth skill across the user's agents. The skill is a single `SKILL.md` every
 * agent reads from its own `~/.<agent>/skills/` dir, so we always run the cross-agent installer via
 * `npx skills add` (no global `skills` needed — npx fetches it on the fly; covers Claude Code / Codex
 * / Coco / Cursor / Gemini / Copilot / …). If that can't run (offline, etc.), fall back to
 * **symlinking** the skill into whichever agent dirs exist on this machine.
 */
async function installSkill(force: boolean): Promise<void> {
  const { resolveSkillsDir, bundledSkillNames, detectAgentSkillDirs, linkBundledSkills } = await import('./skill-install')
  const dir = resolveSkillsDir(dirname(fileURLToPath(import.meta.url)))
  if (!dir) { console.error('berth: could not locate the bundled skills/ directory'); process.exit(1); return }
  const names = bundledSkillNames(dir)

  let ok = names.length > 0
  for (const name of names) {
    const code = await spawnExit('npx', ['--yes', 'skills', 'add', join(dir, name), '-g', '-y'])
    if (code !== 0) { ok = false; break }
  }
  if (ok) {
    console.log(`berth: installed via \`skills\`: ${names.join(', ')} (run \`npx skills list\` to see per-agent placement).`)
    return
  }

  // Fallback: `npx skills add` unavailable/failed — symlink into detected agents ourselves.
  console.error('berth: `npx skills add` failed — falling back to symlinking into detected agents.')
  const targets = detectAgentSkillDirs()
  if (!targets.length) {
    console.error('berth: no supported agent found (looked for ~/.claude, ~/.codex, ~/.cursor, ~/.gemini, ~/.coco).')
    process.exit(1); return
  }
  const results = linkBundledSkills(dir, targets, force)
  for (const r of results) {
    const parts = [r.installed.length ? `linked ${r.installed.join(', ')}` : '', r.skipped.length ? `skipped ${r.skipped.join(', ')} (use --force)` : '']
      .filter(Boolean).join('; ')
    console.log(`  ${r.agent}: ${parts || '(nothing to do)'}`)
  }
}

/** CLI entry. Kept thin: parse, then dispatch. Imports the server lazily so --help/--version are instant. */
export async function runCli(argv: string[], version: string): Promise<void> {
  // Data commands (task/project) talk to a running server over HTTP — dispatched before the start
  // parser so their flags (e.g. --status) aren't misread as server options.
  if (argv[0] === 'task' || argv[0] === 'project') {
    const { runTaskCli, runProjectCli } = await import('./cli-data')
    try {
      if (argv[0] === 'task') await runTaskCli(argv.slice(1))
      else await runProjectCli(argv.slice(1))
    } catch (e: any) { console.error(`berth: ${e?.message ?? e}`); process.exit(1) }
    return
  }

  if (argv[0] === 'skill') {
    if (argv[1] !== 'install') { console.error('berth: usage: berth skill install [--force]'); process.exit(2); return }
    await installSkill(argv.includes('--force'))
    return
  }

  let args: CliArgs
  try { args = parseCliArgs(argv) } catch (e: any) { console.error(`berth: ${e.message}\n`); console.error(HELP); process.exit(2); return }

  if (args.command === 'help') { console.log(HELP); return }
  if (args.command === 'version') { console.log(version); return }

  const { start } = await import('./server/index')
  const host = args.host ?? process.env.HOST ?? '127.0.0.1'
  let started: Awaited<ReturnType<typeof start>>
  try {
    started = await start(args.port, host)
  } catch (e) {
    console.error(formatStartupError(e))
    process.exit(1); return
  }
  const { port, hasWeb } = started
  const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
  // 2.0 SPA lives at /app (1.0 entry deprecated); open it directly when built to skip the redirect hop.
  const url = hasWeb ? `${base}/app/` : base
  if (args.open) openBrowser(url)
}
