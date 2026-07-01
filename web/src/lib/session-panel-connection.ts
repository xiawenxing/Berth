import type { LaunchSpec, RenderMode } from './ui-store'

export interface SessionPanelConnection { sessionId?: string; launch?: LaunchSpec }

export function resolveSessionPanelConnection(sessionId?: string, launch?: LaunchSpec): SessionPanelConnection {
  // Keep a fresh launch's live socket mounted after its launched frame arrives. Switching
  // immediately to resume mode remounts the panel and can wipe in-progress input.
  return launch ? { launch } : { sessionId }
}

export function resolveSessionPanelRenderer(
  cli: string | undefined,
  renderMode: RenderMode,
  connection: SessionPanelConnection,
): RenderMode {
  const canChat = cli === 'claude' || cli === 'codex' || cli === 'coco'
  if (!canChat) return 'A'
  // Coco's interactive TUI resume is a history replay that does not reliably reopen a usable
  // composer. Existing coco sessions continue through the per-turn stream-json driver instead.
  if (cli === 'coco' && connection.sessionId && !connection.launch) return 'B'
  // Keep this in sync with launch-runner's prime socket: free claude/coco launches default to
  // Model B so the first turn is not typed into a booting TUI.
  if (connection.launch && !connection.launch.todoKey && (cli === 'claude' || cli === 'coco')) return 'B'
  return renderMode === 'B' ? 'B' : 'A'
}
