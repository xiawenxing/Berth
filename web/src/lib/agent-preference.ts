import type { AgentCli } from './api'

// Remembers the agent the user last picked when launching a session. Most-recent-wins,
// stored per-machine (localStorage) and therefore global across all projects. Validation
// against the currently-enabled agents happens at the call site.
const LAST_AGENT_KEY = 'berth-last-agent'

export function loadLastAgent(): AgentCli | null {
  try {
    const v = localStorage.getItem(LAST_AGENT_KEY)
    return v ? (v as AgentCli) : null
  } catch {
    return null
  }
}

export function saveLastAgent(cli: AgentCli): void {
  try {
    localStorage.setItem(LAST_AGENT_KEY, cli)
  } catch {
    /* ignore quota */
  }
}
