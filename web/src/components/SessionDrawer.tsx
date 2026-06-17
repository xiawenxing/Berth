import { useEffect, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { Drawer } from './ui/Overlay'
import { SessionChat } from './SessionChat'
import { Terminal } from './Terminal'
import { CliBadge } from './workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import { SHIP_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 60vw right-side session drawer (style 2 — no card). Slim header (no ■/×),
 * chat body, bottom composer whose single button is 发送 ▷ / 终止 ■ (when 在航).
 */
export function SessionDrawer() {
  const { drawer, closeDrawer } = useUI()
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  // Reset composer/running state each time a different session opens.
  useEffect(() => {
    setRunning(drawer?.status === 'sail')
    setMsg('')
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

          {/* body: real live terminal for a real session (/pty); chat preview otherwise */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {drawer.sessionId ? (
              <Terminal key={drawer.sessionId} sessionId={drawer.sessionId} />
            ) : (
              <div className="h-full overflow-y-auto">
                <SessionChat firstUser={drawer.task ? `开始处理任务：${drawer.task}` : undefined} />
              </div>
            )}
          </div>

          {/* Composer only for the chat preview — a real terminal takes input via xterm directly. */}
          {!drawer.sessionId && (
            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-md border border-border bg-card p-2">
                <textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  placeholder="输入消息发送给 agent…"
                  rows={2}
                  className="min-h-0 flex-1 resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-dim"
                />
                {running ? (
                  <button
                    onClick={() => setRunning(false)}
                    className="flex flex-none items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-[12px] font-semibold text-brand-foreground"
                  >
                    <Square size={12} /> 终止
                  </button>
                ) : (
                  <button
                    onClick={() => setMsg('')}
                    className="flex flex-none items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground"
                  >
                    <Send size={12} /> 发送
                  </button>
                )}
              </div>
            </div>
          )}
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
