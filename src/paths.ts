import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Root directory for Berth's OWN writable state — the sqlite db, the docs root default, the first-run
 * seed, and the launch-manifest inject dir. Default `~/.berth`; override with the `BERTH_HOME` env var
 * to run an ISOLATED instance without touching your real data.
 *
 * This is the switch for testing the first-install / init chain: pointing `BERTH_HOME` at a fresh dir
 * gives a never-installed-Berth state (empty db, no pins/attach/tasks/imports) while the read-only CLI
 * session stores (`~/.claude`, `~/.codex`, coco cache) stay on the real home — so the machine's real
 * sessions are still scanned and offered for import, exactly like a new Berth user on an existing box.
 */
export function berthHome(): string {
  return process.env.BERTH_HOME || join(homedir(), '.berth')
}

/** Stable cwd used by Berth's internal management agent so its CLI sessions are discoverable. */
export function berthAgentCwd(): string {
  return join(berthHome(), 'agent-cwd')
}

/** Directory holding Berth's own diagnostic event logs (launch/connection lifecycle), exported for
 *  user bug reports. Lives under BERTH_HOME so an isolated instance keeps its own logs. */
export function berthLogsDir(): string {
  return join(berthHome(), 'logs')
}
