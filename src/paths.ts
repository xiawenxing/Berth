import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Root directory for Berth's OWN writable state — the sqlite db, the docs root default, the first-run
 * seed, and the launch-manifest inject dir. Default `~/.berth`; override with the `BERTH_HOME` env var
 * to run a fully ISOLATED instance (e.g. testing a release build, or simulating an empty first-run)
 * without touching your real data.
 *
 * Note: this relocates only Berth's own state. The read-only CLI session stores (`~/.claude`,
 * `~/.codex`, coco cache) are NOT moved — so an isolated Berth still SEES your real sessions. To get a
 * fully empty sidebar (no sessions either), override `HOME` instead (os.homedir() honors it), which
 * moves everything.
 */
export function berthHome(): string {
  return process.env.BERTH_HOME || join(homedir(), '.berth')
}

/** Stable cwd used by Berth's internal management agent so its CLI sessions are discoverable. */
export function berthAgentCwd(): string {
  return join(berthHome(), 'agent-cwd')
}
