import type { LaunchSpec } from './ui-store'

export function resolveSessionPanelConnection(sessionId?: string, launch?: LaunchSpec): { sessionId?: string; launch?: LaunchSpec } {
  // Keep a fresh launch's live socket mounted after its launched frame arrives. Switching
  // immediately to resume mode remounts the panel and can wipe in-progress input.
  return launch ? { launch } : { sessionId }
}
