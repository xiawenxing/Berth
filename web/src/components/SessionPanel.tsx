import { Terminal } from './Terminal'
import { ChatTranscript } from './ChatTranscript'
import { Composer } from './Composer'
import { useChatSession } from '@/lib/useChatSession'
import { useUI, type LaunchSpec } from '@/lib/ui-store'
import { resolveSessionPanelConnection, resolveSessionPanelRenderer } from '@/lib/session-panel-connection'
import { useEffect, useState } from 'react'
import { isSessionTerminateKeyboardEvent } from '@/lib/terminal-shortcuts'

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
  onTerminateShortcut,
}: {
  cli?: string
  sessionId?: string
  launch?: LaunchSpec
  onLaunched?: (sessionId: string) => void
  onTerminateShortcut?: () => void
}) {
  const { renderMode } = useUI()
  const effectiveCli = cli ?? launch?.cli
  const connection = resolveSessionPanelConnection(sessionId, launch)
  // A live session with no jsonl on disk (launched, never typed into) cannot be respawned as a TUI,
  // so the server pins it to its stream driver and says so. Honour that over the global render mode
  // — otherwise the terminal renders chat frames as raw text ({"type":"snapshot","turns":[]}).
  const [streamPinned, setStreamPinned] = useState(false)
  useEffect(() => { setStreamPinned(false) }, [connection.sessionId, connection.launch?.launchToken])
  const active = streamPinned ? 'B' : resolveSessionPanelRenderer(effectiveCli, renderMode, connection)

  if (active === 'B') {
    const key = connection.launch ? `B:launch:${connection.launch.launchToken ?? 'pending'}` : `B:${connection.sessionId}`
    return <ChatPanel key={key} sessionId={connection.sessionId} launch={connection.launch} onLaunched={onLaunched} onTerminateShortcut={onTerminateShortcut} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {connection.launch ? (
        <Terminal key="A:launch" launch={connection.launch} onLaunched={onLaunched} onTerminateShortcut={onTerminateShortcut} />
      ) : connection.sessionId ? (
        <Terminal key={`A:${connection.sessionId}`} sessionId={connection.sessionId} onTerminateShortcut={onTerminateShortcut} onStreamModePinned={() => setStreamPinned(true)} />
      ) : null}
    </div>
  )
}

function ChatPanel({ sessionId, launch, onLaunched, onTerminateShortcut }: { sessionId?: string; launch?: LaunchSpec; onLaunched?: (sessionId: string) => void; onTerminateShortcut?: () => void }) {
  const chat = useChatSession({ sessionId, launch, onLaunched, onExited: onTerminateShortcut })
  const draftScope = launch?.launchToken ? `launch:${launch.launchToken}` : sessionId ? `session:${sessionId}` : 'unknown'
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSessionTerminateKeyboardEvent(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (!chat.terminate()) return
      window.setTimeout(() => onTerminateShortcut?.(), 0)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [chat, onTerminateShortcut])
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      <ChatTranscript turns={chat.turns} thinking={chat.thinking} loading={chat.historyLoading} error={chat.historyError} />
      <Composer onSend={chat.send} onInterrupt={chat.interrupt} busy={chat.busy} draftScope={draftScope} />
    </div>
  )
}
