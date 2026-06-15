import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * True if `cmd` is resolvable on the current PATH. Cross-platform: `which` on POSIX, `where` on
 * Windows. Used to capability-gate optional integrations (e.g. the Feishu plugin needs `lark-cli`)
 * so the core works for anyone who doesn't have that tooling installed.
 *
 * (This module is the seed of the planned OS-branch lynchpin: it will grow to own binary discovery
 * and per-OS store roots; for now it only owns PATH probing.)
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    await exec(probe, [cmd])
    return true
  } catch {
    return false
  }
}
