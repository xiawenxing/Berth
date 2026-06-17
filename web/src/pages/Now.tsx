import { useMemo, useState } from 'react'
import { Pin, Play, ChevronDown, CalendarClock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import { useData, shortCwd } from '@/lib/data'
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
  const { tasks, sessions } = useData()
  const live = useLive()

  const byId = useMemo(() => {
    const m = new Map<string, ApiSession>()
    for (const s of sessions) m.set(s.sessionId, s)
    return m
  }, [sessions])

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
                onLaunch={() => openLaunch({ dest: 'task', taskTitle: t.title })}
              />
            ))}
          </div>
        </section>

        {/* 船只 */}
        <ShipSection icon={<Pin size={13} />} title="Pin" ships={pinShips} onOpen={openSession} />
        <ShipSection title="未读 · 靠岸·待查收" ships={dockShips} onOpen={openSession} />
        <ShipSection title="运行中 · 在航" ships={sailShips} onOpen={openSession} />
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
  if (status === 'sail') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-transparent ring-1 ring-brand" />
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
          <button
            key={s.sessionId}
            onClick={() => onOpen(s)}
            className="flex h-[34px] items-center gap-2 rounded px-2 text-left hover:bg-sidebar-accent"
          >
            <ShipGlyph status={live.shipStatus(s.sessionId, s.updatedAt)} />
            <ProjTag proj={s.project} />
            <CliBadge cli={s.cli} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {s.title || s.sessionId}
            </span>
          </button>
        ))}
      </div>
    </section>
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
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{t.title}</span>
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
                <button key={s.sessionId} onClick={() => onOpen(s)} className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1 text-left hover:border-muted-foreground">
                  <ShipGlyph status={live.shipStatus(s.sessionId, s.updatedAt)} />
                  <CliBadge cli={s.cli} />
                  <span className="truncate text-[12px] text-foreground">{s.title || s.sessionId}</span>
                </button>
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
