import { useState } from 'react'
import { Terminal } from './Terminal'
import { ChatTranscript } from './ChatTranscript'
import { Composer } from './Composer'
import { useChatSession } from '@/lib/useChatSession'
import type { LaunchSpec } from '@/lib/ui-store'

type Mode = 'A' | 'B'
const MODE_KEY = 'berth-render-mode'

function loadMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'B' ? 'B' : 'A' } catch { return 'A' }
}

/**
 * The Model A / Model B seam on the frontend. One mount point for a session; an in-panel toggle swaps
 * the interactive xterm terminal (A) for the stream-json chat renderer (B). Mode is a per-spawn render
 * choice persisted globally (localStorage) — switching it remounts the body, and the backend kills +
 * respawns the session in the requested mode (so the same session id works in either view).
 *
 * Model B is claude-only for now; the toggle is hidden for other CLIs (they always render as Model A).
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
  const [mode, setMode] = useState<Mode>(loadMode)
  const effectiveCli = cli ?? launch?.cli
  const canChat = effectiveCli === 'claude'
  const active: Mode = canChat ? mode : 'A'

  const choose = (m: Mode) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {canChat && (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/60 bg-canvas px-3 py-1.5">
          <Segmented active={active === 'A'} onClick={() => choose('A')} label="终端" />
          <Segmented active={active === 'B'} onClick={() => choose('B')} label="对话" />
        </div>
      )}
      {active === 'B' ? (
        <ChatPanel key={`B:${sessionId ?? 'launch'}`} sessionId={sessionId} launch={launch} onLaunched={onLaunched} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {sessionId ? (
            <Terminal key={`A:${sessionId}`} sessionId={sessionId} />
          ) : launch ? (
            <Terminal key="A:launch" launch={launch} onLaunched={onLaunched} />
          ) : null}
        </div>
      )}
    </div>
  )
}

function Segmented({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs ${active ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {label}
    </button>
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
