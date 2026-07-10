import { delimiter } from 'node:path'

export interface AgentAddr { port: number; host: string; binDir: string }

const PARENT_CODEX_ENV_KEYS = [
  'CODEX_CI',
  'CODEX_THREAD_ID',
  'CODEX_PARENT_THREAD_ID',
  'CODEX_SUBAGENT_ID',
  'CODEX_TASK_ID',
]

/**
 * Build the env for a Berth-spawned agent PTY: prepend the berth-shim dir to PATH and advertise the
 * server address via BERTH_PORT/BERTH_HOST so the agent's `berth task …` finds the CLI and connects to
 * the server that launched it. Returns a new object; never mutates input. `addr` null → address skipped.
 *
 * NOTE: when the clipboard-fix branch (release/clipboard-mac-roman-flavor) merges, the `withUtf8Locale`
 * helper should be applied here too (one place for all agent-env injection). Intentionally omitted now
 * because that helper does not exist on this branch yet.
 */
export function agentSpawnEnv(baseEnv: NodeJS.ProcessEnv, addr: AgentAddr | null, sessionId?: string, agentBinDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  // Berth is often launched from inside Codex Desktop/Codex CLI. Those parent-session variables are
  // meaningful to the controlling Codex process, but they should not leak into a nested Codex TUI
  // spawned as the user's actual agent session. Keep CODEX_HOME/auth-related config intact; only drop
  // transient identity/CI markers that can make the child behave like part of the parent run.
  for (const key of PARENT_CODEX_ENV_KEYS) delete env[key]
  const pathPrefixes = [addr?.binDir, agentBinDir].filter((p): p is string => !!p)
  if (pathPrefixes.length) {
    // Keep Berth's own shim first (so `berth task done` cannot hit an older global install), then
    // the resolved agent's directory. The latter is load-bearing for npm/NVM shims whose shebang is
    // `#!/usr/bin/env node`: a GUI/server PATH may not contain the Node beside that shim.
    env.PATH = [...new Set(pathPrefixes), env.PATH ?? ''].filter(Boolean).join(delimiter)
  }
  if (addr) {
    env.BERTH_PORT = String(addr.port)
    env.BERTH_HOST = addr.host
  }
  // Self-bind anchor: lets the agent's `berth session bind` resolve its own session deterministically.
  // claude/coco get a pre-minted id at launch; codex mints late, so it stays unset and self-bind falls
  // back to a cwd match (see cli-data.selectCurrentSession).
  if (sessionId) env.BERTH_SESSION_ID = sessionId
  return env
}
