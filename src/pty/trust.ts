import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CLAUDE_CONFIG = join(homedir(), '.claude.json')
const codexConfig = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')

/**
 * Pure: return `config` with `projects[realCwd].hasTrustDialogAccepted = true`, creating the
 * projects map / the entry when absent and preserving every other field. Mutates and returns the
 * passed object (it is always a fresh parse from disk in production).
 */
export function withTrustedProject(config: any, realCwd: string): any {
  const cfg = config && typeof config === 'object' ? config : {}
  if (!cfg.projects || typeof cfg.projects !== 'object') cfg.projects = {}
  const existing = cfg.projects[realCwd] && typeof cfg.projects[realCwd] === 'object' ? cfg.projects[realCwd] : {}
  cfg.projects[realCwd] = { ...existing, hasTrustDialogAccepted: true }
  return cfg
}

/**
 * Best-effort: mark `cwd` as a trusted Claude workspace so an interactive (PTY) launch does not
 * block on the "Is this a project you created or one you trust?" dialog.
 *
 * Why this is needed: claude only auto-skips the workspace-trust dialog in NON-interactive mode
 * (`-p` / non-TTY) — Berth always runs claude interactively in a PTY, so the dialog DOES appear and,
 * because Berth sessions are unattended, nothing answers it. The auto-submitted task directive then
 * never fires (so the agent never takes a turn, writes no transcript, and never surfaces in the
 * session list). `--dangerously-skip-permissions` does not clear this gate. claude keys trust by the
 * RESOLVED real path (e.g. /tmp → /private/tmp on macOS), so we must realpath the cwd first.
 *
 * Never throws: on any failure the launch proceeds unchanged (claude just shows the dialog as before).
 */
export function ensureClaudeTrust(cwd: string, configPath: string = CLAUDE_CONFIG): void {
  try {
    let real = cwd
    try { real = realpathSync(cwd) } catch {}

    let config: any = {}
    try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch {}

    // Already trusted → skip the rewrite. Avoids churning the large config file on every launch and
    // minimizes the window for clobbering a concurrently-running claude's own write-back.
    if (config?.projects?.[real]?.hasTrustDialogAccepted === true) return

    writeFileSync(configPath, JSON.stringify(withTrustedProject(config, real), null, 2))
  } catch {
    // best-effort; never block a launch on trust-seeding
  }
}

/**
 * Pure: return `toml` text with a trusted `[projects."<realCwd>"]` table, or null if no change is
 * needed. codex stores per-directory trust as `[projects."<path>"]\ntrust_level = "trusted"` in
 * config.toml; if that table header already exists we leave it alone (codex owns it — adding a
 * duplicate would be invalid TOML), otherwise we APPEND a fresh table. Appending (vs full rewrite)
 * preserves every existing setting and minimizes clobbering a concurrent codex write.
 */
export function withTrustedCodexProject(toml: string, realCwd: string): string | null {
  const header = `[projects."${realCwd}"]`
  if (toml.includes(header)) return null
  return toml.replace(/\n*$/, '\n') + `\n${header}\ntrust_level = "trusted"\n`
}

/**
 * Best-effort: mark `cwd` as a trusted codex directory so an interactive (PTY) launch does not block
 * on the "Do you trust the contents of this directory?" dialog. Same rationale as ensureClaudeTrust:
 * Berth runs codex unattended in a PTY, so nothing answers the dialog and the positional prompt never
 * fires. `--dangerously-bypass-approvals-and-sandbox` does NOT clear this gate (verified: the dialog
 * still appears with it set). codex keys trust by the RESOLVED real path. Never throws.
 */
export function ensureCodexTrust(cwd: string, configPath: string = codexConfig()): void {
  try {
    let real = cwd
    try { real = realpathSync(cwd) } catch {}

    let toml = ''
    try { toml = readFileSync(configPath, 'utf8') } catch {}

    const updated = withTrustedCodexProject(toml, real)
    if (updated == null) return   // already has a [projects."<real>"] table

    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, updated)
  } catch {
    // best-effort; never block a launch on trust-seeding
  }
}
