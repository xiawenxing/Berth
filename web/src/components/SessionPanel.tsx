import { Terminal } from './Terminal'
import { ChatTranscript } from './ChatTranscript'
import { Composer } from './Composer'
import { useChatSession } from '@/lib/useChatSession'
import { useUI, type LaunchSpec } from '@/lib/ui-store'
import { resolveSessionPanelConnection } from '@/lib/session-panel-connection'

/**
 * The Model A / Model B seam on the frontend. One mount point for a session; the active renderer is
 * the GLOBAL render mode (set in Settings, persisted in localStorage) — Model A is the interactive
 * xterm terminal, Model B the stream-json chat view. Both attach to the same persistent process via
 * /pty; the backend kills + respawns on a mode switch so the same session id works in either view.
 *
 * All three CLIs support Model B (claude / codex / coco); the toggle has no effect for any other cli.
 */
export function SessionPanel({
  cli,
  sessionId,
  launch,
  onLaunched,
}: {
  cli?: string
  sessionId?: string
  launch?: LaunchSpec
  onLaunched?: (sessionId: string) => void
}) {
  const { renderMode } = useUI()
  const effectiveCli = cli ?? launch?.cli
  const connection = resolveSessionPanelConnection(sessionId, launch)
  // All three CLIs support Model B (claude = persistent stream-json; codex/coco = per-turn).
  const canChat = effectiveCli === 'claude' || effectiveCli === 'codex' || effectiveCli === 'coco'
  const active = canChat && renderMode === 'B' ? 'B' : 'A'

  if (active === 'B') {
    const key = connection.launch ? `B:launch:${connection.launch.launchToken ?? 'pending'}` : `B:${connection.sessionId}`
    return <ChatPanel key={key} sessionId={connection.sessionId} launch={connection.launch} onLaunched={onLaunched} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {connection.launch ? (
        <Terminal key="A:launch" launch={connection.launch} onLaunched={onLaunched} />
      ) : connection.sessionId ? (
        <Terminal key={`A:${connection.sessionId}`} sessionId={connection.sessionId} />
      ) : null}
    </div>
  )
}

function ChatPanel({ sessionId, launch, onLaunched }: { sessionId?: string; launch?: LaunchSpec; onLaunched?: (sessionId: string) => void }) {
  const chat = useChatSession({ sessionId, launch, onLaunched })
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      <ChatTranscript turns={chat.turns} thinking={chat.thinking} loading={chat.historyLoading} error={chat.historyError} />
      <Composer onSend={chat.send} onInterrupt={chat.interrupt} busy={chat.busy} />
    </div>
  )
}
