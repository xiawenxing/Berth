import { Terminal } from './Terminal'
import { ChatTranscript } from './ChatTranscript'
import { Composer } from './Composer'
import { useChatSession } from '@/lib/useChatSession'
import { useUI, type LaunchSpec } from '@/lib/ui-store'

/**
 * The Model A / Model B seam on the frontend. One mount point for a session; the active renderer is
 * the GLOBAL render mode (set in Settings, persisted in localStorage) — Model A is the interactive
 * xterm terminal, Model B the stream-json chat view. Both attach to the same persistent process via
 * /pty; the backend kills + respawns on a mode switch so the same session id works in either view.
 *
 * Model B is claude-only for now; other CLIs always render as Model A regardless of the global mode.
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
  const active = effectiveCli === 'claude' && renderMode === 'B' ? 'B' : 'A'

  if (active === 'B') {
    return <ChatPanel key={`B:${sessionId ?? 'launch'}`} sessionId={sessionId} launch={launch} onLaunched={onLaunched} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {sessionId ? (
        <Terminal key={`A:${sessionId}`} sessionId={sessionId} />
      ) : launch ? (
        <Terminal key="A:launch" launch={launch} onLaunched={onLaunched} />
      ) : null}
    </div>
  )
}

function ChatPanel({ sessionId, launch, onLaunched }: { sessionId?: string; launch?: LaunchSpec; onLaunched?: (sessionId: string) => void }) {
  const chat = useChatSession({ sessionId, launch, onLaunched })
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      <ChatTranscript turns={chat.turns} />
      <Composer onSend={chat.send} onInterrupt={chat.interrupt} busy={chat.busy} />
    </div>
  )
}
