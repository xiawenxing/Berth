import { useEffect, useMemo, useRef, useState } from 'react'
import { Pin, Play, ChevronDown, CalendarClock, Check, Sparkles, MoreHorizontal, CircleDot } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { AnchoredPopover, MenuItem } from '@/components/ui/Menu'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { shortCwd } from '@/lib/format'
import { api } from '@/lib/api'
import { priorityColors, priorityRank } from '@/lib/priority'
import { isDoneStatus } from '@/lib/status'
import { useLive } from '@/lib/live'
import type { ShipStatus } from '@/lib/types'
import type { ApiSession, ApiTask } from '@/lib/api'


/** Local YYYY-MM-DD for "today" — matches the backend ddl format. */
function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function Now() {
  const { openDrawer, openLaunch } = useUI()
  const { tasks, sessions, projects, pending } = useData()
  const live = useLive()

  const byId = useMemo(() => {
    const m = new Map<string, ApiSession>()
    for (const s of sessions) m.set(s.sessionId, s)
    return m
  }, [sessions])

  // In-flight launches → optimistic 创建中… ships at the top of 在航 (dropped once the real session
  // surfaces; see DataProvider). Saves the user a manual 同步 to see what they just started.
  const pendingShips = useMemo<ApiSession[]>(
    () =>
      pending
        .filter((p) => !p.surfaced)
        .map((p) => ({
          sessionId: p.sessionId ?? p.tempId,
          cli: p.cli,
          title: p.sessionId ? '启动中…' : '创建中…',
          cwd: p.cwd,
          updatedAt: Math.floor(p.createdAt / 1000),
          projectId: p.projectId,
          project: projects.find((x) => x.id === p.projectId)?.name,
          __pending: true,
          __pendingOpenable: !!p.sessionId,
        })),
    [pending, projects],
  )

  // Launch a session bound to this task by its real id (todoKey) + project — never by title. The
  // spawn cwd is resolved in LaunchDialog from the project's enabled 货舱 (falling back to that
  // project's Berth workspace dir, server-side), so Now only needs to carry the projectId.
  const launchTask = (t: ApiTask) =>
    openLaunch({ dest: 'task', taskTitle: t.title, projectId: t.projectId ?? undefined, todoKey: t.id })

  // 今日交付: tasks whose ddl is today's local date, across all projects.
  const today = todayISO()
  const todayTasks = useMemo(() => tasks.filter((t) => t.ddl === today), [tasks, today])
  const doneN = todayTasks.filter((t) => isDoneStatus(t.status)).length

  // Ship sections: real sessions across all projects, project-tagged.
  const pinShips = useMemo(() => sessions.filter((s) => s.pinned), [sessions])
  const dockShips = useMemo(
    () => sessions.filter((s) => live.shipStatus(s.sessionId, s.updatedAt) === 'dock'),
    [sessions, live],
  )
  const sailShips = useMemo(
    () => sessions.filter((s) => live.shipStatus(s.sessionId, s.updatedAt) === 'sail'),
    [sessions, live],
  )

  const openSession = (s: ApiSession) => {
    live.markSeen(s.sessionId)
    openDrawer({
      title: s.title || s.sessionId,
      cli: s.cli,
      cwd: shortCwd(s.cwd),
      status: live.shipStatus(s.sessionId, s.updatedAt),
      sessionId: s.sessionId,
    })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <h1 className="text-[17px] font-bold text-foreground">Now</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">跨项目收件箱</p>
      </header>

      <div className="flex w-full flex-col gap-5 px-6 py-5">
        {/* 今日交付 */}
        <section>
          <SectionHead>
            今日交付 <span className="text-text-dim">{doneN}/{todayTasks.length}</span>
          </SectionHead>
          <div className="flex flex-col gap-1.5">
            {todayTasks.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                resolve={(id) => byId.get(id)}
                onOpen={openSession}
                onLaunch={() => launchTask(t)}
              />
            ))}
          </div>
        </section>

        {/* 船只 */}
        <ShipSection icon={<Pin size={13} />} title="Pin" ships={pinShips} onOpen={openSession} />
        <ShipSection title="未读 · 靠岸·待查收" ships={dockShips} onOpen={openSession} />
        <ShipSection title="运行中 · 在航" ships={[...pendingShips, ...sailShips]} onOpen={openSession} />
      </div>
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">{children}</div>
}

function ProjTag({ proj }: { proj?: string }) {
  if (!proj) return null
  return <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{proj}</span>
}

function ShipGlyph({ status }: { status: ShipStatus }) {
  if (status === 'sail') return <Spinner size={11} className="text-brand" label="在航" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" title="有未读" />
  return <span className="h-1.5 w-1.5 flex-none" />
}

function ShipSection({
  icon,
  title,
  ships,
  onOpen,
}: {
  icon?: React.ReactNode
  title: string
  ships: ApiSession[]
  onOpen: (s: ApiSession) => void
}) {
  const live = useLive()
  return (
    <section>
      <SectionHead>
        {icon}
        {title} <span className="text-text-dim">{ships.length}</span>
      </SectionHead>
      <div className="flex flex-col">
        {ships.map((s) => (
          <ShipRow key={s.sessionId} s={s} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function ShipRow({ s, onOpen }: { s: ApiSession; onOpen: (s: ApiSession) => void }) {
  const live = useLive()
  const ship = live.shipStatus(s.sessionId, s.updatedAt)
  const pending = !!s.__pending
  const pendingOpenable = pending && !!s.__pendingOpenable

  return (
    <div
      role="button"
      tabIndex={pending && !pendingOpenable ? -1 : 0}
      onClick={() => (!pending || pendingOpenable) && onOpen(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (!pending || pendingOpenable) onOpen(s)
        }
      }}
      className={cn(
        'group flex h-[34px] items-center gap-2 rounded px-2 text-left',
        pending && !pendingOpenable ? 'cursor-default text-muted-foreground' : 'cursor-pointer hover:bg-sidebar-accent',
      )}
    >
      <ShipGlyph status={ship} />
      <ProjTag proj={s.project} />
      <CliBadge cli={s.cli} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={s.title || s.sessionId}>
        {s.title || s.sessionId}
      </span>
      <SessionActions s={s} ship={ship} pending={pending} />
    </div>
  )
}

function SessionActions({ s, ship, pending }: { s: ApiSession; ship: ShipStatus; pending?: boolean }) {
  const live = useLive()
  const { reload } = useData()
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [kicked, setKicked] = useState(false) // instant feedback until titleGenerating takes over
  const [failed, setFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const generating = kicked || !!s.titleGenerating
  useEffect(() => { if (s.titleGenerating) setKicked(false) }, [s.titleGenerating])

  const generateTitle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (generating || pending) return
    setFailed(false)
    setKicked(true)
    try {
      // Detached: kick + reload so titleGenerating shows; the title streams in via the sessions poll
      // even if this row scrolls off / the page changes.
      await api.sessionTitle(s.sessionId)
      reload()
      window.setTimeout(() => setKicked(false), 8000)
    } catch {
      // 404/422 (e.g. empty session) — flash red so a non-update isn't silent.
      setKicked(false)
      setFailed(true)
      window.setTimeout(() => setFailed(false), 2500)
    }
  }

  const togglePin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pending) return
    try {
      await api.pin(s.sessionId, !s.pinned)
      reload()
    } catch {
      reload()
    }
  }

  const markRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    live.markSeen(s.sessionId)
  }

  const markUnread = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    live.markUnread(s.sessionId)
  }

  if (pending) {
    return (
      <span className="inline-flex flex-none items-center rounded bg-muted-foreground/15 px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
        创建中
      </span>
    )
  }

  return (
    <div className="flex flex-none items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={generateTitle}
        disabled={generating}
        title={generating ? '正在智能生成标题…' : failed ? '生成失败，点击重试' : '智能生成标题'}
        aria-label="智能生成标题"
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded text-text-dim transition-opacity hover:bg-secondary hover:text-foreground disabled:opacity-50',
          generating ? 'opacity-100' : failed ? 'text-destructive opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Sparkles size={12} className={cn(generating && 'spk-twinkle', failed && 'text-destructive')} />
      </button>
      <button
        type="button"
        onClick={togglePin}
        title={s.pinned ? '取消 Pin' : 'Pin 此会话'}
        aria-label={s.pinned ? '取消 Pin' : 'Pin 此会话'}
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded transition-opacity hover:bg-secondary',
          s.pinned ? 'text-priority opacity-100' : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100',
        )}
      >
        <Pin size={12} />
      </button>
      <button
        ref={moreBtnRef}
        type="button"
        title="更多"
        aria-label="更多"
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded text-text-dim transition-opacity hover:bg-secondary hover:text-foreground',
          menuOpen ? 'bg-secondary text-foreground opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <MoreHorizontal size={13} />
      </button>
      {menuOpen && (
        <AnchoredPopover anchor={moreBtnRef} width={184} onClose={() => setMenuOpen(false)}>
          {ship === 'dock' ? (
            <MenuItem onClick={markRead}>
              <Check size={13} className="flex-none text-muted-foreground" /> 标为已读
            </MenuItem>
          ) : (
            <MenuItem onClick={markUnread}>
              <CircleDot size={13} className="flex-none text-muted-foreground" /> 标为未读
            </MenuItem>
          )}
        </AnchoredPopover>
      )}
    </div>
  )
}

function TaskRow({
  t,
  resolve,
  onOpen,
  onLaunch,
}: {
  t: ApiTask
  resolve: (sessionId: string) => ApiSession | undefined
  onOpen: (s: ApiSession) => void
  onLaunch: () => void
}) {
  const [open, setOpen] = useState(false)
  const live = useLive()
  const { priorities } = useData()
  const { rank, total } = priorityRank(t.priority, priorities)
  const delivered = isDoneStatus(t.status)
  const linked = (t.sessions ?? []).map((id) => resolve(id)).filter((s): s is ApiSession => !!s)

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-card">
      <span className="absolute left-0 top-0 h-full w-[2px]" style={{ background: priorityColors(rank, total).bar }} />
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 py-2 pl-3 pr-2 text-left">
        <ProjTag proj={t.project} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={t.title}>{t.title}</span>
        {delivered ? (
          <span className="flex items-center gap-0.5 text-[10.5px] text-success"><Check size={11} /> 已交付</span>
        ) : (
          <span className="flex items-center gap-0.5 rounded bg-warning/15 px-1 py-0.5 text-[10.5px] text-warning"><CalendarClock size={11} /> 今日</span>
        )}
        <button onClick={(e) => { e.stopPropagation(); onLaunch() }} className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-success">
          <Play size={11} /> 启动
        </button>
        <ChevronDown size={14} className={cn('text-text-dim transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mx-2 mb-2 rounded-md bg-brand/[0.04] p-2">
          <p className="text-[12px] text-muted-foreground">{t.progress || '暂无进展摘要'}</p>
          {linked.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {linked.map((s) => (
                <div
                  key={s.sessionId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpen(s)
                    }
                  }}
                  className="group flex items-center gap-2 rounded border border-border bg-card px-2 py-1 text-left hover:border-muted-foreground"
                >
                  <ShipGlyph status={live.shipStatus(s.sessionId, s.updatedAt)} />
                  <CliBadge cli={s.cli} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={s.title || s.sessionId}>{s.title || s.sessionId}</span>
                  <SessionActions s={s} ship={live.shipStatus(s.sessionId, s.updatedAt)} />
                </div>
              ))}
            </div>
          ) : (
            <button onClick={onLaunch} className="mt-2 flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[12px] text-muted-foreground hover:border-brand hover:text-brand">
              <Play size={12} /> 起会话
            </button>
          )}
        </div>
      )}
    </div>
  )
}
