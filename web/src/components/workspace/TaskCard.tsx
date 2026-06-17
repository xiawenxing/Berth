import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Play,
  ChevronDown,
  Link2,
  MoreHorizontal,
  CalendarClock,
  Sparkles,
  Folder,
  Search,
  ListChecks,
  X,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_ORDER, type Priority, type Task, type ShipStatus, type TaskStatus } from '@/lib/types'

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
  onActivate,
  onSetStatus,
  onSetPriority,
  onRename,
  onDelete,
}: {
  task: Task
  active: boolean
  onLaunch?: (taskTitle: string) => void
  onOpenSession?: (title: string) => void
  onActivate?: () => void
  onSetStatus?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onRename?: (taskId: string, title: string) => void
  onDelete?: (taskId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const done = task.status === '已完成'
  const cancelled = task.status === '已取消'
  const isLive = !done && !cancelled
  const expandable = active && isLive
  const linkN = task.links?.length ?? 0
  const runningOrUnread = task.links?.find((l) => l.status === 'sail' || l.status === 'dock')
  const [dragging, setDragging] = useState(false)

  // Clicking the card body: in the active column toggle expand; in an inactive
  // (narrow) column promote that column to active.
  const onCardClick = () => {
    if (expandable) setOpen((v) => !v)
    else if (!active) onActivate?.()
  }

  return (
    <div
      data-prio={task.priority}
      draggable
      onDragStart={(e) => {
        setDragging(true)
        e.dataTransfer.setData('text/plain', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => setDragging(false)}
      onClick={onCardClick}
      className={cn(
        // shrink-0: in a scrolling flex-column the card must keep its natural height,
        // else many cards compress to thin bars and clip the title (the done-column bug).
        'kanban-card group relative shrink-0 overflow-hidden rounded-sm border border-border shadow-sm active:cursor-grabbing hover:border-muted-foreground',
        expandable || !active ? 'cursor-pointer' : 'cursor-grab',
        open && 'ring-1 ring-brand/40',
        dragging && 'opacity-45',
      )}
    >
      {/* 4px priority left-bar */}
      <button
        className={cn('absolute left-0 top-0 bottom-0 w-1', PRIO_BAR[task.priority])}
        title={`优先级 ${task.priority}`}
        onClick={(e) => e.stopPropagation()}
      />

      {/* head (title row) — padding lives here, not on the card, for tight density */}
      <div className={cn('flex items-center gap-1.5 pr-2.5 pl-[13px]', active ? 'py-[7px]' : 'py-[6px]')}>
        {/* status glyph only in the active column for live cards */}
        {active && isLive && runningOrUnread && <ShipGlyph status={runningOrUnread.status} />}
        <span
          className={cn(
            'min-w-0 flex-1 text-[13px] font-semibold leading-[1.35] text-card-foreground',
            // 2 lines for active live cards; reliable single-line truncate everywhere else
            // (line-clamp-1 collapses the title height in a flex row when there's no other content).
            active && isLive ? 'line-clamp-2 [overflow-wrap:anywhere]' : 'truncate',
            done && 'font-medium text-muted-foreground',
            cancelled && 'font-medium text-text-dim line-through',
          )}
        >
          {task.title}
        </span>
        {/* AI refine indicator */}
        {task.summary === REFINING && (
          <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-muted-foreground">
            <Sparkles size={11} className="spk-twinkle" /> 总结中…
          </span>
        )}
        {/* ▷启动 — v7 .kcard-go: quiet muted marker (icon + 启动), success only on hover; collapse-only, live cards */}
        {!open && active && isLive && task.summary !== REFINING && (
          <button
            title="为此任务起会话"
            className="inline-flex h-[18px] flex-none items-center gap-[3px] rounded px-1.5 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-success"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch?.(task.title)
            }}
          >
            <Play size={11} /> 启动
          </button>
        )}
        {active && expandable && (
          <ChevronDown size={14} className={cn('flex-none text-text-dim transition-transform', open && 'rotate-180')} />
        )}
        {/* done/cancelled cards: hover ⋯ in the head (no footer) */}
        {(done || cancelled) && (
          <MoreMenu
            task={task}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            onSetStatus={onSetStatus}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* footer — live cards only. Active: full (link · glyph · ddl · ⋯). Inactive: compact (set-ddl + ⋯). */}
      {isLive && (
        <div className={cn('flex items-center gap-1.5 pr-2 pl-[13px] pb-[6px]', active ? '-mt-0.5' : '-mt-1')}>
          {active && linkN > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">
              <Link2 size={11} /> {linkN}
            </span>
          )}
          {/* show ddl: active shows even unset hint; inactive only when set */}
          {(active || task.ddl) && <DdlChip ddl={task.ddl} />}
          <span className="flex-1" />
          <MoreMenu
            task={task}
            className={cn(
              'rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground',
              !active && 'opacity-0 transition-opacity group-hover:opacity-100',
            )}
            onSetStatus={onSetStatus}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      )}

      {/* expanded: summary + linked sessions — full-bleed block with a top border (design .kcard-exp) */}
      {open && (
        <div className="border-t border-border bg-brand/[0.04] px-[13px] py-2.5">
          {task.summary && <p className="text-[12px] leading-relaxed text-muted-foreground">{task.summary}</p>}
          {linkN > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {task.links!.map((l, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenSession?.(l.title)
                  }}
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
              onClick={(e) => {
                e.stopPropagation()
                onLaunch?.(task.title)
              }}
              className="mt-2 flex items-center gap-1 rounded border border-dashed border-brand/50 px-2 py-1 text-[12px] text-brand hover:border-brand hover:bg-brand/[0.06]"
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

const STATUS_ICON: Record<TaskStatus, typeof Folder> = {
  待办: Folder,
  进行中: Play,
  待评估: Search,
  已完成: ListChecks,
  已取消: X,
}

const PRIO_CHIP: Record<Priority, string> = {
  P0: 'bg-destructive/15 text-destructive',
  P1: 'bg-priority/15 text-priority',
  P2: 'bg-muted text-muted-foreground',
}

type MenuActions = {
  onSetStatus?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onRename?: (taskId: string, title: string) => void
  onDelete?: (taskId: string) => void
}

/** ⋯ trigger + its popover. The popover is portaled to <body> with fixed positioning so it
 *  escapes the card's `overflow-hidden` and the column body's `overflow-y-auto` (which otherwise
 *  clip an in-card absolute menu to nothing — the "menu doesn't open" bug). */
function MoreMenu({ task, className, ...actions }: { task: Task; className: string } & MenuActions) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen((v) => !v)
  }
  return (
    <button ref={btnRef} className={cn('relative flex-none', className)} onClick={toggle}>
      <MoreHorizontal size={13} />
      {open && <TaskMenu task={task} anchor={btnRef} onClose={() => setOpen(false)} {...actions} />}
    </button>
  )
}

/** Fixed-position popover anchored under a trigger button, portaled to <body>. 状态 / 优先级 /
 *  重命名 / 删除. Click-outside (button included) + Esc close; flips above when near the viewport bottom. */
function TaskMenu({
  task,
  anchor,
  onClose,
  onSetStatus,
  onSetPriority,
  onRename,
  onDelete,
}: {
  task: Task
  anchor: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
} & MenuActions) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Position under the trigger (right-aligned), flipping above if it would overflow the viewport.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const W = 176 // w-44
      const H = ref.current?.offsetHeight ?? 300
      const left = Math.max(8, Math.min(a.right - W, window.innerWidth - W - 8))
      const below = a.bottom + 4
      const top = below + H > window.innerHeight - 8 ? Math.max(8, a.top - H - 4) : below
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchor])

  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
    onClose()
  }

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-dim">{children}</div>
  )
  const Item = ({ children, onClick, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) => (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-accent',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground',
      )}
    >
      {children}
    </button>
  )

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-50 w-44 rounded-md border border-border bg-popover p-1 shadow-lg"
    >
      <Label>状态 — 移动到列</Label>
      {STATUS_ORDER.map((s) => {
        const Icon = STATUS_ICON[s]
        return (
          <Item key={s} onClick={pick(() => onSetStatus?.(task.id, s))}>
            <Icon size={13} className="flex-none text-muted-foreground" />
            <span className="flex-1">{s}</span>
            {task.status === s && <span className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />}
          </Item>
        )
      })}
      <div className="my-1 border-t border-border" />
      <Label>优先级</Label>
      {(['P0', 'P1', 'P2'] as Priority[]).map((p) => (
        <Item key={p} onClick={pick(() => onSetPriority?.(task.id, p))}>
          <span className={cn('flex-none rounded px-1 text-[10px] font-bold', PRIO_CHIP[p])}>{p}</span>
          <span className="flex-1">{p === 'P0' ? '高' : p === 'P1' ? '中' : '低'}</span>
          {task.priority === p && <span className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />}
        </Item>
      ))}
      <div className="my-1 border-t border-border" />
      <Item
        onClick={pick(() => {
          const next = window.prompt('重命名任务', task.title)
          if (next && next.trim() && next.trim() !== task.title) onRename?.(task.id, next.trim())
        })}
      >
        <Pencil size={13} className="flex-none text-muted-foreground" /> 重命名
      </Item>
      <Item danger onClick={pick(() => onDelete?.(task.id))}>
        <Trash2 size={13} className="flex-none" /> 删除
      </Item>
    </div>,
    document.body,
  )
}
