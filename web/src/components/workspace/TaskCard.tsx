import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
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
import { useData } from '@/lib/data'
import { priorityColors, priorityRank } from '@/lib/priority'
import { STATUS_ORDER, type Priority, type Task, type ShipStatus, type TaskStatus } from '@/lib/types'

const REFINING = '港务助手正在总结进展摘要…'

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

type MenuActions = {
  onSetStatus?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onRename?: (taskId: string, title: string) => void
  onDelete?: (taskId: string) => void
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
} & MenuActions) {
  const { priorities } = useData()
  const [open, setOpen] = useState(false)
  const done = task.status === '已完成'
  const cancelled = task.status === '已取消'
  const isLive = !done && !cancelled
  const expandable = active && isLive
  const linkN = task.links?.length ?? 0
  const runningOrUnread = task.links?.find((l) => l.status === 'sail' || l.status === 'dock')
  const [dragging, setDragging] = useState(false)

  const { rank, total } = priorityRank(task.priority, priorities)
  const pc = priorityColors(rank, total)

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
      {/* 2px priority left-bar — color comes from the ordered-priority ramp (lib/priority) */}
      <span className="pointer-events-none absolute left-0 top-0 bottom-0 z-[1] w-[2px]" style={{ background: pc.bar }} />

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
        {/* compact (inactive-column) live cards: ddl-if-set + priority chip ride in the head (single-row, dense) */}
        {!active && isLive && (
          <>
            {task.ddl && <DdlChip ddl={task.ddl} />}
            <PrioChip task={task} priorities={priorities} onSetPriority={onSetPriority} />
          </>
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
            priorities={priorities}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            onSetStatus={onSetStatus}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* footer — active live cards: priority chip · link · ddl · ⋯ */}
      {active && isLive && (
        <div className="-mt-0.5 flex items-center gap-1.5 pr-2 pl-[13px] pb-[6px]">
          <PrioChip task={task} priorities={priorities} onSetPriority={onSetPriority} />
          {linkN > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">
              <Link2 size={11} /> {linkN}
            </span>
          )}
          <DdlChip ddl={task.ddl} />
          <span className="flex-1" />
          <MoreMenu
            task={task}
            priorities={priorities}
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
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

// ── shared popover primitive ────────────────────────────────────────────────

/** A popover portaled to <body> and fixed-positioned under `anchor`, so it escapes the card's
 *  overflow-hidden and the column body's overflow-y-auto. Closes on outside-click (anchor
 *  included, so the trigger toggles cleanly) and Esc; flips above when near the viewport bottom. */
function AnchoredPopover({
  anchor,
  onClose,
  width,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const H = ref.current?.offsetHeight ?? 280
      const left = Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8))
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
  }, [anchor, width])

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

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-50 rounded-md border border-border bg-popover p-1 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  )
}

const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-dim">{children}</div>
)
const MenuItem = ({ children, onClick, danger }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) => (
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

/** A ramp-colored priority pill (P0/P1/…); `interactive` adds hover affordance for menus. */
function PrioPill({ label, rank, total, interactive }: { label: string; rank: number; total: number; interactive?: boolean }) {
  const c = priorityColors(rank, total)
  return (
    <span
      className={cn('inline-flex flex-none items-center rounded px-1.5 text-[10px] font-bold tracking-[0.3px]', interactive && 'leading-[16px]')}
      style={{ background: c.chipBg, color: c.chipFg }}
    >
      {label}
    </span>
  )
}

/** Priority list — used by both the quick chip popover and the full ⋯ menu. */
function PriorityList({ task, priorities, onSetPriority, close }: { task: Task; priorities: string[]; onSetPriority?: (id: string, p: Priority) => void; close: () => void }) {
  return (
    <>
      <MenuLabel>优先级</MenuLabel>
      {priorities.map((p, i) => (
        <MenuItem
          key={p}
          onClick={(e) => {
            e.stopPropagation()
            onSetPriority?.(task.id, p)
            close()
          }}
        >
          <PrioPill label={p} rank={i} total={priorities.length} />
          <span className="flex-1" />
          {task.priority === p && <span className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />}
        </MenuItem>
      ))}
    </>
  )
}

// ── the clickable priority chip on a card ────────────────────────────────────

function PrioChip({ task, priorities, onSetPriority }: { task: Task; priorities: string[]; onSetPriority?: (id: string, p: Priority) => void }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { rank, total } = priorityRank(task.priority, priorities)
  const c = priorityColors(rank, total)
  return (
    <button
      ref={btnRef}
      title="设置优先级"
      onClick={(e) => {
        e.stopPropagation()
        setOpen((v) => !v)
      }}
      className="inline-flex h-[18px] flex-none items-center rounded px-1.5 text-[10px] font-bold tracking-[0.3px] transition-[filter] hover:brightness-105"
      style={{ background: c.chipBg, color: c.chipFg }}
    >
      {task.priority}
      {open && (
        <AnchoredPopover anchor={btnRef} width={150} onClose={() => setOpen(false)}>
          <PriorityList task={task} priorities={priorities} onSetPriority={onSetPriority} close={() => setOpen(false)} />
        </AnchoredPopover>
      )}
    </button>
  )
}

// ── the ⋯ overflow menu ──────────────────────────────────────────────────────

function MoreMenu({ task, priorities, className, ...actions }: { task: Task; priorities: string[]; className: string } & MenuActions) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <button
      ref={btnRef}
      className={cn('relative flex-none', className)}
      onClick={(e) => {
        e.stopPropagation()
        setOpen((v) => !v)
      }}
    >
      <MoreHorizontal size={13} />
      {open && (
        <TaskMenu task={task} priorities={priorities} anchor={btnRef} onClose={() => setOpen(false)} {...actions} />
      )}
    </button>
  )
}

/** Full task menu: 状态 / 优先级 / 重命名 / 删除. */
function TaskMenu({
  task,
  priorities,
  anchor,
  onClose,
  onSetStatus,
  onSetPriority,
  onRename,
  onDelete,
}: {
  task: Task
  priorities: string[]
  anchor: RefObject<HTMLButtonElement | null>
  onClose: () => void
} & MenuActions) {
  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
    onClose()
  }
  return (
    <AnchoredPopover anchor={anchor} width={176} onClose={onClose}>
      <MenuLabel>状态 — 移动到列</MenuLabel>
      {STATUS_ORDER.map((s) => {
        const Icon = STATUS_ICON[s]
        return (
          <MenuItem key={s} onClick={pick(() => onSetStatus?.(task.id, s))}>
            <Icon size={13} className="flex-none text-muted-foreground" />
            <span className="flex-1">{s}</span>
            {task.status === s && <span className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />}
          </MenuItem>
        )
      })}
      <div className="my-1 border-t border-border" />
      <PriorityList task={task} priorities={priorities} onSetPriority={onSetPriority} close={onClose} />
      <div className="my-1 border-t border-border" />
      <MenuItem
        onClick={pick(() => {
          const next = window.prompt('重命名任务', task.title)
          if (next && next.trim() && next.trim() !== task.title) onRename?.(task.id, next.trim())
        })}
      >
        <Pencil size={13} className="flex-none text-muted-foreground" /> 重命名
      </MenuItem>
      <MenuItem danger onClick={pick(() => onDelete?.(task.id))}>
        <Trash2 size={13} className="flex-none" /> 删除
      </MenuItem>
    </AnchoredPopover>
  )
}
