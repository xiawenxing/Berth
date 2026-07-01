import { useEffect, useRef, useState } from 'react'
import { Drawer } from './ui/Overlay'
import { SessionPanel } from './SessionPanel'
import { SessionTitleBar } from './SessionTitleBar'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { useLive } from '@/lib/live'
import { api } from '@/lib/api'
import { logDiag } from '@/lib/diag'

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
  // the real id on the placeholder. Keep the fresh-launch socket mounted so the first turn continues
  // streaming in place; future opens can attach by the real session id.
  const optimisticTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (optimisticTimer.current !== null) clearTimeout(optimisticTimer.current)
  }, [])
  // Log drawer open/close transitions. A close while a launch is still in flight (no sessionId bound
  // yet) is the exact action that used to strand a session — keeping it on the timeline makes that
  // sequence visible in an exported report.
  const prevDrawerRef = useRef<typeof drawer>(null)
  useEffect(() => {
    const prev = prevDrawerRef.current
    if (!prev && drawer) {
      logDiag('ui', 'drawer_open', { launchToken: drawer.launch?.launchToken, sessionId: drawer.sessionId ?? undefined, cli: drawer.cli, isLaunch: !!drawer.launch })
    } else if (prev && !drawer) {
      logDiag('ui', 'drawer_close', { launchToken: prev.launch?.launchToken, sessionId: prev.sessionId ?? undefined, cli: prev.cli, wasLaunch: !!prev.launch, hadSessionId: !!prev.sessionId })
    }
    prevDrawerRef.current = drawer
  }, [drawer])
  // Tell live which session is on screen so output landing on it stays read (see live.tsx act
  // handler). Without this, a result that arrives while the drawer is open would surface as unread
  // until the user closes & reopens the session.
  const { setActiveSession } = live
  useEffect(() => {
    setActiveSession(drawer?.sessionId ?? null)
    return () => setActiveSession(null)
  }, [drawer?.sessionId, setActiveSession])
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
    if (drawer) {
      openDrawer({ ...drawer, sessionId, status: 'sail' })
    }
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
            generating={!!currentSession?.titleGenerating}
            onRename={async (title) => {
              if (!drawer.sessionId) return
              await api.renameSessionTitle(drawer.sessionId, title)
              openDrawer({ ...drawer, title })
              reload()
            }}
            onGenerate={
              drawer.sessionId
                ? async () => {
                    // Detached: kick + reload so the spinner (titleGenerating) shows; the new title
                    // streams in via the sessions poll even if the drawer is closed.
                    await api.sessionTitle(drawer.sessionId!)
                    reload()
                  }
                : undefined
            }
          />

          {/* body: terminal (Model A) or stream-json chat (Model B), chosen by the in-panel toggle.
              Both attach to the same persistent process via /pty; the backend respawns on a mode switch. */}
          {drawer.launch ? (
            <SessionPanel key={`launch:${drawer.launch.launchToken ?? 'pending'}`} cli={drawer.cli} sessionId={drawer.sessionId} launch={drawer.launch} onLaunched={resyncAfterLaunch} />
          ) : drawer.sessionId ? (
            <SessionPanel key={drawer.sessionId} cli={drawer.cli} sessionId={drawer.sessionId} />
          ) : null}
        </>
      )}
    </Drawer>
  )
}
