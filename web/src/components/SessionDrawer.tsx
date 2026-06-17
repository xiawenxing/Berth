import { useEffect, useState } from 'react'
import { Drawer } from './ui/Overlay'
import { SessionChat } from './SessionChat'
import { Terminal } from './Terminal'
import { CliBadge } from './workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import { SHIP_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 60vw right-side session drawer (style 2 — no card). Slim header (no ■/×).
 * Body: a real session renders its conversation as a codex-style chat transcript;
 * a fresh launch renders the live terminal. No composer — the transcript is read-only history.
 */
export function SessionDrawer() {
  const { drawer, closeDrawer } = useUI()
  const [running, setRunning] = useState(false)

  // Reflect 在航 state in the header pill each time a different session opens.
  useEffect(() => {
    setRunning(drawer?.status === 'sail')
  }, [drawer?.title, drawer?.status])

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

          {/* body: a REAL session renders its conversation as a codex-style chat transcript;
              a fresh LAUNCH (no sessionId yet) renders the live terminal (watching a new agent sail). */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {drawer.sessionId ? (
              <div className="h-full overflow-y-auto">
                <SessionChat key={drawer.sessionId} sessionId={drawer.sessionId} />
              </div>
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
