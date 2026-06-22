import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Home dir used to resolve Berth's DATA / CONFIG / SESSION paths: Berth's own state (`berthHome`), the
 * CLI session stores Berth scans (`storeRoots`), the per-CLI config Berth reads/writes on launch
 * (claude trust, codex home, coco hook), and the `HOME` handed to spawned CLI children. Defaults to
 * the real home; set `BERTH_TEST_HOME` to a directory to simulate a CLEAN first-install machine —
 * empty sidebar, isolated Berth state, sessions you launch land in the test dir and surface there.
 *
 * Binary resolution (`src/pty/binaries.ts`) intentionally does NOT use this — it must find the REAL
 * installed CLIs. That data-vs-binary split is exactly why `BERTH_TEST_HOME` works where overriding
 * `HOME` does not (overriding `HOME` empties the binary candidate paths, so launching breaks).
 */
export function dataHome(): string {
  return process.env.BERTH_TEST_HOME || homedir()
}

/**
 * Root directory for Berth's OWN writable state — the sqlite db, the docs root default, the first-run
 * seed, and the launch-manifest inject dir. Default `<dataHome>/.berth`; an explicit `BERTH_HOME`
 * still wins (a fully ISOLATED instance without touching real data). With only `BERTH_TEST_HOME` set,
 * Berth state lands under the clean test dir alongside the relocated session stores.
 */
export function berthHome(): string {
  return process.env.BERTH_HOME || join(dataHome(), '.berth')
}

/** Stable cwd used by Berth's internal management agent so its CLI sessions are discoverable. */
export function berthAgentCwd(): string {
  return join(berthHome(), 'agent-cwd')
}
