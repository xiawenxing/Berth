import type { AgentIntegrationStatus } from './api'

export const AGENT_INTEGRATION_CHANGED = 'berth:agent-integration-changed'

export function notifyAgentIntegrationChanged(status: AgentIntegrationStatus): void {
  window.dispatchEvent(new CustomEvent<AgentIntegrationStatus>(AGENT_INTEGRATION_CHANGED, { detail: status }))
}
