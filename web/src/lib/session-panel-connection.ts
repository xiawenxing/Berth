import type { LaunchSpec } from './ui-store'

export function resolveSessionPanelConnection(sessionId?: string, launch?: LaunchSpec): { sessionId?: string; launch?: LaunchSpec } {
  return sessionId ? { sessionId } : { launch }
}
