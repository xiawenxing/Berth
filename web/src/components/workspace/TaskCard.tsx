import { useState } from 'react'
import { Play, ChevronDown, Link2, MoreHorizontal, CalendarClock, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, ShipStatus } from '@/lib/types'

const REFINING = '港务助手正在总结进展摘要…'

const SHIP_DOT: Record<ShipStatus, string> = {
  sail: 'bg-success', // 在航
  dock: 'ring-1 ring-brand', // 靠岸·待查收 (hollow)
  moored: 'hidden', // 已停泊 — no dot
}

function ShipGlyph({ status }: { status: ShipStatus }) {
  if (status === 'moored') return null
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 flex-none rounded-full',
        status === 'sail' ? 'bg-success' : 'bg-transparent ring-1 ring-brand',
      )}
    />
  )
}

function DdlChip({ ddl }: { ddl?: string | null }) {
  if (!ddl) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px] font-medium text-text-dim opacity-60 hover:bg-muted hover:opacity-100">
        <CalendarClock size={11} /> 截止
      </span>
    )
  }
  const overdue = ddl.startsWith('逾期')
  const today = ddl === '今日'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px] font-medium',
        today && 'bg-warning/15 text-warning',
        overdue && 'bg-destructive/15 text-destructive',
        !today && !overdue && 'bg-muted text-muted-foreground',
      )}
    >
      <CalendarClock size={11} /> {ddl}
    </span>
  )
}

const PRIO_BAR: Record<string, string> = {
  P0: 'bg-destructive',
  P1: 'bg-priority',
  P2: 'bg-border/70',
}

export function TaskCard({
  task,
  active,
  onLaunch,
  onOpenSession,
}: {
  task: Task
  active: boolean
  onLaunch?: (taskTitle: string) => void
  onOpenSession?: (title: string) => void
}) {
  const [open, setOpen] = useState(false)
  const done = task.status === '已完成'
  const cancelled = task.status === '已取消'
  const expandable = active && !done && !cancelled
  const linkN = task.links?.length ?? 0
  const runningOrUnread = task.links?.find((l) => l.status === 'sail' || l.status === 'dock')

  return (
    <div
      data-prio={task.priority}
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-card pl-3 pr-2.5 py-1.5',
        open && 'ring-1 ring-brand/40',
      )}
    >
      {/* 4px priority left-bar */}
      <button
        className={cn('absolute left-0 top-0 h-full w-1', PRIO_BAR[task.priority])}
        title={`优先级 ${task.priority}`}
      />

      <div
        className={cn('flex items-center gap-1.5', expandable && 'cursor-pointer')}
        onClick={() => expandable && setOpen((v) => !v)}
      >
        {runningOrUnread && <ShipGlyph status={runningOrUnread.status} />}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-semibold text-card-foreground',
            done && 'font-medium text-muted-foreground',
            cancelled && 'font-medium text-text-dim line-through',
          )}
        >
          {task.title}
        </span>
        {/* AI refine indicator (sparkle twinkle) */}
        {task.summary === REFINING && (
          <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-muted-foreground">
            <Sparkles size={11} className="spk-twinkle" /> 总结中…
          </span>
        )}
        {/* ▷启动 — collapse-only */}
        {!open && active && task.summary !== REFINING && (
          <button
            className="inline-flex h-[18px] flex-none items-center gap-0.5 rounded px-1.5 text-[10.5px] font-semibold text-muted-foreground hover:bg-secondary hover:text-success"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch?.(task.title)
            }}
          >
            <Play size={11} /> 启动
          </button>
        )}
        {expandable && <ChevronDown size={14} className={cn('flex-none text-text-dim transition-transform', open && 'rotate-180')} />}
      </div>

      {/* footer */}
      {active && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {linkN > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground">
              <Link2 size={11} /> {linkN}
            </span>
          )}
          <DdlChip ddl={task.ddl} />
          <span className="flex-1" />
          <button className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal size={13} />
          </button>
        </div>
      )}

      {/* expanded: summary + linked sessions */}
      {open && (
        <div className="mt-2 rounded-md bg-brand/[0.04] p-2">
          {task.summary && <p className="text-[12px] leading-relaxed text-muted-foreground">{task.summary}</p>}
          {linkN > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {task.links!.map((l, i) => (
                <button
                  key={i}
                  onClick={() => onOpenSession?.(l.title)}
                  className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1 text-left hover:border-muted-foreground"
                >
                  <ShipGlyph status={l.status} />
                  <CliBadge cli={l.cli} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{l.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => onLaunch?.(task.title)}
              className="mt-2 flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[12px] text-muted-foreground hover:border-brand hover:text-brand"
            >
              <Play size={12} /> 起会话
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CliBadge({ cli }: { cli: string }) {
  const tone =
    cli === 'claude' ? 'bg-brand/15 text-brand' : cli === 'codex' ? 'bg-success/15 text-success' : 'bg-purple/15 text-purple'
  return <span className={cn('flex-none rounded px-1.5 py-0.5 text-[10.5px] font-medium', tone)}>{cli}</span>
}
