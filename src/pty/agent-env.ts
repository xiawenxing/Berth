import { delimiter } from 'node:path'

export interface AgentAddr { port: number; host: string; binDir: string }

/**
 * Build the env for a Berth-spawned agent PTY: prepend the berth-shim dir to PATH and advertise the
 * server address via BERTH_PORT/BERTH_HOST so the agent's `berth task …` finds the CLI and connects to
 * the server that launched it. Returns a new object; never mutates input. `addr` null → address skipped.
 *
 * NOTE: when the clipboard-fix branch (release/clipboard-mac-roman-flavor) merges, the `withUtf8Locale`
 * helper should be applied here too (one place for all agent-env injection). Intentionally omitted now
 * because that helper does not exist on this branch yet.
 */
export function agentSpawnEnv(baseEnv: NodeJS.ProcessEnv, addr: AgentAddr | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  if (addr) {
    env.PATH = addr.binDir + delimiter + (env.PATH ?? '')
    env.BERTH_PORT = String(addr.port)
    env.BERTH_HOST = addr.host
  }
  return env
}
