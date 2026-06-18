import { useEffect, useRef, useState } from 'react'
import { Drawer } from './ui/Overlay'
import { Terminal } from './Terminal'
import { CliBadge } from './workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { useLive } from '@/lib/live'
import { SHIP_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 60vw right-side session drawer (style 2 — no card). Slim header (no ■/×).
 * Body: real sessions attach to the same persistent PTY renderer used for fresh launches, preserving
 * native CLI behavior, streaming, prompts, MCP/skill output, HITL commands and terminal styling.
 */
export function SessionDrawer() {
  const { drawer, closeDrawer, openDrawer } = useUI()
  const { sessions, resync } = useData()
  const live = useLive()
  const [optimisticLiveId, setOptimisticLiveId] = useState<string | null>(null)
  // A fresh launch's session jsonl is written when the CLI initializes/takes its first turn,
  // which lags the launch by a beat. `GET /api/sessions` serves a disk-scan cache, so re-scan a
  // few times after launch to let the new session surface in the list (and rebind links/attach).
  const resyncTimers = useRef<number[]>([])
  const optimisticTimer = useRef<number | null>(null)
  useEffect(() => () => {
    resyncTimers.current.forEach((t) => clearTimeout(t))
    if (optimisticTimer.current !== null) clearTimeout(optimisticTimer.current)
  }, [])
  const resyncAfterLaunch = (sessionId: string) => {
    resyncTimers.current.forEach((t) => clearTimeout(t))
    resyncTimers.current = [800, 2500, 6000].map((ms) => window.setTimeout(() => void resync(), ms))
    setOptimisticLiveId(sessionId)
    if (optimisticTimer.current !== null) clearTimeout(optimisticTimer.current)
    optimisticTimer.current = window.setTimeout(() => setOptimisticLiveId((id) => (id === sessionId ? null : id)), 8000)
    if (drawer) openDrawer({ ...drawer, sessionId, status: 'sail', launch: undefined })
  }

  const currentSession = drawer?.sessionId ? sessions.find((s) => s.sessionId === drawer.sessionId) : undefined
  const currentStatus = drawer?.sessionId
    ? optimisticLiveId === drawer.sessionId
      ? 'sail'
      : live.shipStatus(drawer.sessionId, currentSession?.updatedAt)
    : drawer?.status

  return (
    <Drawer open={!!drawer} onClose={closeDrawer}>
      {drawer && (
        <>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <CliBadge cli={drawer.cli} />
            <span className="truncate text-[13px] font-semibold text-foreground">{drawer.title}</span>
            <span className="font-mono text-[11px] text-text-dim">{drawer.cwd}</span>
            <ShipPill status={currentStatus ?? drawer.status} />
            {drawer.task && <span className="text-[11px] text-muted-foreground">· 航线 {drawer.task}</span>}
          </div>

          {/* body: existing and newly-launched sessions share the native PTY transport/renderer. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawer.sessionId ? (
              <Terminal key={drawer.sessionId} sessionId={drawer.sessionId} />
            ) : drawer.launch ? (
              <Terminal key="launch" launch={drawer.launch} onLaunched={resyncAfterLaunch} />
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
