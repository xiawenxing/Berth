import { useEffect, useState } from 'react'
import { Drawer } from './ui/Overlay'
import { SessionChat } from './SessionChat'
import { SessionComposer } from './SessionComposer'
import { Terminal } from './Terminal'
import { CliBadge } from './workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import { SHIP_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 60vw right-side session drawer (style 2 — no card). Slim header (no ■/×).
 * Body: a real session renders its conversation as a codex-style chat transcript with a bottom
 * composer; sending a message resumes the session live (a <Terminal> with the message auto-submitted)
 * so the user continues the conversation. A fresh launch renders the live terminal directly.
 */
export function SessionDrawer() {
  const { drawer, closeDrawer } = useUI()
  const [running, setRunning] = useState(false)
  // When the user sends a follow-up, switch the body from the chat transcript to a live resumed
  // terminal that auto-submits this text. Reset whenever a different session opens.
  const [resumeInput, setResumeInput] = useState<string | null>(null)

  // Reflect 在航 state in the header pill each time a different session opens.
  useEffect(() => {
    setRunning(drawer?.status === 'sail')
  }, [drawer?.title, drawer?.status])

  // A different session opened → drop any pending resume so we show its transcript first.
  useEffect(() => {
    setResumeInput(null)
  }, [drawer?.sessionId])

  return (
    <Drawer open={!!drawer} onClose={closeDrawer}>
      {drawer && (
        <>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <CliBadge cli={drawer.cli} />
            <span className="truncate text-[13px] font-semibold text-foreground">{drawer.title}</span>
            <span className="font-mono text-[11px] text-text-dim">{drawer.cwd}</span>
            <ShipPill status={running ? 'sail' : drawer.status} />
            {drawer.task && <span className="text-[11px] text-muted-foreground">· 航线 {drawer.task}</span>}
          </div>

          {/* body: a REAL session renders its conversation as a codex-style chat transcript with a
              bottom composer; sending resumes the session live (a <Terminal> that auto-submits the
              message). A fresh LAUNCH (no sessionId yet) renders the live terminal directly. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawer.sessionId ? (
              resumeInput !== null ? (
                <div className="min-h-0 flex-1">
                  <Terminal key={`resume-${drawer.sessionId}`} sessionId={drawer.sessionId} initialInput={resumeInput} />
                </div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SessionChat key={drawer.sessionId} sessionId={drawer.sessionId} />
                  </div>
                  <SessionComposer onSend={setResumeInput} />
                </>
              )
            ) : drawer.launch ? (
              <Terminal key="launch" launch={drawer.launch} />
            ) : null}
          </div>
        </>
      )}
    </Drawer>
  )
}

function ShipPill({ status }: { status: 'sail' | 'dock' | 'moored' }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px]',
        status === 'sail' && 'bg-success/15 text-success',
        status === 'dock' && 'bg-brand/15 text-brand',
        status === 'moored' && 'bg-muted text-muted-foreground',
      )}
    >
      {status === 'sail' && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
      {SHIP_LABEL[status]}
    </span>
  )
}
