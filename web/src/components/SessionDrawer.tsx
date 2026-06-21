import { useEffect, useRef, useState } from 'react'
import { Drawer } from './ui/Overlay'
import { Terminal } from './Terminal'
import { SessionTitleBar } from './SessionTitleBar'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { useLive } from '@/lib/live'
import { api } from '@/lib/api'

/**
 * 60vw right-side session drawer (style 2 — no card). Slim header (no ■/×).
 * Body: real sessions attach to the same persistent PTY renderer used for fresh launches, preserving
 * native CLI behavior, streaming, prompts, MCP/skill output, HITL commands and terminal styling.
 */
export function SessionDrawer() {
  const { drawer, closeDrawer, openDrawer } = useUI()
  const { sessions, reload, resolvePending } = useData()
  const live = useLive()
  const [optimisticLiveId, setOptimisticLiveId] = useState<string | null>(null)
  // A fresh launch's session jsonl is written when the CLI initializes/takes its first turn, which
  // lags the launch by a beat (and well past it for slow CLIs). The data layer drives the disk
  // re-scan loop (off its `pending` placeholders) until the session surfaces — here we just record
  // the real id on the placeholder and flip the drawer onto the live session.
  const optimisticTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (optimisticTimer.current !== null) clearTimeout(optimisticTimer.current)
  }, [])
  useEffect(() => {
    const onRekey = (e: Event) => {
      const detail = (e as CustomEvent<{ from?: string; to?: string }>).detail
      if (!detail?.from || !detail?.to || drawer?.sessionId !== detail.from) return
      openDrawer({ ...drawer, sessionId: detail.to })
      reload()
    }
    window.addEventListener('berth:session-rekey', onRekey)
    return () => window.removeEventListener('berth:session-rekey', onRekey)
  }, [drawer, openDrawer, reload])
  const resyncAfterLaunch = (sessionId: string) => {
    if (drawer?.launch?.launchToken) resolvePending(drawer.launch.launchToken, sessionId)
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
          <SessionTitleBar
            cli={drawer.cli}
            title={currentSession?.title || drawer.title}
            cwd={drawer.cwd}
            status={currentStatus ?? drawer.status}
            task={drawer.task}
            editable={!!drawer.sessionId}
            onRename={async (title) => {
              if (!drawer.sessionId) return
              await api.renameSessionTitle(drawer.sessionId, title)
              openDrawer({ ...drawer, title })
              reload()
            }}
            onGenerate={
              drawer.sessionId
                ? async () => {
                    const { title } = await api.sessionTitle(drawer.sessionId!)
                    if (title) openDrawer({ ...drawer, title })
                    reload()
                    return title
                  }
                : undefined
            }
          />

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
