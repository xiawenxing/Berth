import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { dataHome } from '../paths'

// dataHome() (call-time) so BERTH_TEST_HOME writes trust where the test-home child reads it.
const claudeConfigPath = () => join(dataHome(), '.claude.json')

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
export function ensureClaudeTrust(cwd: string, configPath: string = claudeConfigPath()): void {
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
