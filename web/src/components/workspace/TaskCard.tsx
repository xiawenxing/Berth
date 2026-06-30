import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { Play, ChevronDown, ChevronRight, Link2, MoreHorizontal, CalendarClock, Sparkles, Trash2, FileText } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { AnchoredPopover, MenuLabel, MenuItem } from '@/components/ui/Menu'
import { TaskSummaryPopover } from '@/components/AiPanels'
import { useData } from '@/lib/data'
import { imagePathPlaceholderText } from '@/lib/format'
import { useInlineEdit } from '@/lib/useInlineEdit'
import { priorityColors, priorityRank } from '@/lib/priority'
import { isCancelledStatus, isDoneStatus, statusMeta } from '@/lib/status'
import { type LinkedSession, type Priority, type Task, type ShipStatus, type TaskStatus } from '@/lib/types'

const REFINING = '港务助手正在总结进展摘要…'

function ShipGlyph({ status }: { status: ShipStatus }) {
  if (status === 'moored') return null
  // sail=运行中(蓝色 loading), dock=未读(红点) — mirrors the session-list lamp.
  if (status === 'sail') return <Spinner size={11} className="text-brand" label="在航" />
  return <span className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" title="有未读" />
}

function localIso(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDdl(ddl: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ddl)
  if (!m) return { label: ddl, tone: 'muted' as const, title: ddl }
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  const target = new Date(y, mo - 1, day)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff < 0) return { label: `逾期 ${Math.abs(diff)}天`, tone: 'overdue' as const, title: ddl }
  if (diff === 0) return { label: '今日', tone: 'today' as const, title: ddl }
  if (diff === 1) return { label: '明天', tone: 'soon' as const, title: ddl }
  return {
    label: target.getFullYear() === now.getFullYear() ? `${mo}/${day}` : `${y}/${mo}/${day}`,
    tone: 'muted' as const,
    title: ddl,
  }
}

function CompactOverdueIcon({ ddl }: { ddl?: string | null }) {
  if (!ddl) return null
  const display = formatDdl(ddl)
  if (display.tone !== 'overdue') return null
  return (
    <span
      title={`截止日期：${display.title}（${display.label}）`}
      className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-destructive/15 text-destructive"
      aria-label={display.label}
    >
      <CalendarClock size={12} />
    </span>
  )
}

function DdlChip({
  task,
  onSetDdl,
}: {
  task: Task
  onSetDdl?: (taskId: string, ddl: string | null) => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const ddl = task.ddl
  const setDdl = (next: string | null) => {
    onSetDdl?.(task.id, next)
    setOpen(false)
  }
  if (!ddl) {
    return (
      <button
        ref={btnRef}
        type="button"
        title="设置截止日期"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="relative inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px] font-medium text-text-dim opacity-60 hover:bg-muted hover:opacity-100"
      >
        <CalendarClock size={11} /> 截止
        {open && <DdlMenu anchor={btnRef} ddl={null} onSet={setDdl} onClose={() => setOpen(false)} />}
      </button>
    )
  }
  const display = formatDdl(ddl)
  return (
    <button
      ref={btnRef}
      type="button"
      title={`截止日期：${display.title}`}
      onClick={(e) => {
        e.stopPropagation()
        setOpen((v) => !v)
      }}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px] font-medium hover:brightness-105',
        display.tone === 'today' && 'bg-warning/15 text-warning',
        display.tone === 'overdue' && 'bg-destructive/15 text-destructive',
        display.tone !== 'today' && display.tone !== 'overdue' && 'bg-muted text-muted-foreground',
      )}
    >
      <CalendarClock size={11} /> {display.label}
      {open && <DdlMenu anchor={btnRef} ddl={ddl} onSet={setDdl} onClose={() => setOpen(false)} />}
    </button>
  )
}

function DdlMenu({
  anchor,
  ddl,
  onSet,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  ddl: string | null
  onSet: (ddl: string | null) => void
  onClose: () => void
}) {
  return (
    <AnchoredPopover anchor={anchor} width={190} onClose={onClose}>
      <MenuLabel>截止日期</MenuLabel>
      <div className="px-2 pb-1">
        <input
          type="date"
          defaultValue={ddl ?? localIso()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.currentTarget.value) onSet(e.currentTarget.value)
          }}
          className="h-7 w-full rounded border border-input bg-background px-2 text-[12px] text-foreground outline-none focus:border-ring"
        />
      </div>
      <MenuItem onClick={() => onSet(localIso())}>今日</MenuItem>
      <MenuItem onClick={() => onSet(localIso(1))}>明天</MenuItem>
      <MenuItem onClick={() => onSet(localIso(7))}>下周</MenuItem>
      {ddl && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuItem danger onClick={() => onSet(null)}>清除截止日期</MenuItem>
        </>
      )}
    </AnchoredPopover>
  )
}

type MenuActions = {
  onSetStatus?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onSetDdl?: (taskId: string, ddl: string | null) => void
  onRename?: (taskId: string, title: string) => void
  onGenerateTitle?: (taskId: string) => void
  titleGenerating?: boolean
  onDelete?: (taskId: string) => void
  onOpenContext?: (task: Task) => void
}

export function TaskCard({
  task,
  active,
  onLaunch,
  onOpenSession,
  onActivate,
  onSetStatus,
  onSetPriority,
  onSetDdl,
  onRename,
  onGenerateTitle,
  titleGenerating,
  onDelete,
  onOpenContext,
}: {
  task: Task
  active: boolean
  onLaunch?: (taskId: string) => void
  onOpenSession?: (link: LinkedSession) => void
  onActivate?: () => void
} & MenuActions) {
  const { priorities, statuses, reload } = useData()
  const [open, setOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const done = isDoneStatus(task.status)
  const cancelled = isCancelledStatus(task.status)
  const isLive = !done && !cancelled
  const linkN = task.links?.length ?? 0
  // Done/cancelled cards stay expandable when they carry content (linked sessions / a summary) —
  // matching v7's `.kcard.done.expandable` — so delivered work can still be reviewed. Plain
  // done cards (no content) collapse to a single line. Expansion only in the active (wide) column.
  const hasContent = linkN > 0 || !!task.summary || !!task.summarizing
  const expandable = active && (isLive || hasContent)
  const runningOrUnread = task.links?.find((l) => l.status === 'sail' || l.status === 'dock')
  const [dragging, setDragging] = useState(false)

  // Inline rename — double-click the title, or ⋯ menu → 重命名 (calls startRename).
  // Shared with project rename / settings-add via the useInlineEdit hook.
  const { editing, start, inputProps } = useInlineEdit(task.title, (next) => onRename?.(task.id, next))
  const startRename = () => {
    if (onRename) start()
  }

  // Clicking the card body: in the active column toggle expand; in an inactive
  // (narrow) column promote that column to active.
  const onCardClick = () => {
    if (expandable) setOpen((v) => !v)
    else if (!active) onActivate?.()
  }

  return (
    <div
      data-prio={task.priority}
      draggable={!editing}
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
        // Berth 1.0 card: raised .kanban-card surface, no shadow, transparent border that only
        // becomes visible when the card is expanded.
        'kanban-card group relative shrink-0 overflow-hidden rounded-md border active:cursor-grabbing',
        open ? 'border-border' : 'border-transparent',
        expandable || !active ? 'cursor-pointer' : 'cursor-grab',
        dragging && 'opacity-45',
      )}
    >
      {/* head (title row) — padding lives here, not on the card, for tight density */}
      <div className={cn('flex items-center gap-1.5 pr-2.5 pl-[13px]', active ? 'py-[7px]' : 'py-[6px]')}>
        {/* running/unread glyph for live cards — in BOTH active and inactive (narrow) columns, so a
            task with a live or unread session is visible at a glance without expanding the column */}
        {isLive && runningOrUnread && <ShipGlyph status={runningOrUnread.status} />}
        {editing ? (
          <input
            {...inputProps}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-input bg-background px-1 py-px text-[13px] font-semibold leading-[1.35] text-foreground outline-none focus:border-ring"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation()
              startRename()
            }}
            title={onRename ? `${task.title}（双击重命名）` : task.title}
            className={cn(
              'min-w-0 flex-1 font-semibold text-card-foreground',
              // Inactive/narrow columns are thumbnail cards for every status: smaller two-line
              // titles keep done/cancelled visually consistent with live compact cards.
              active && isLive
                ? 'text-[13px] leading-[1.35] line-clamp-2 [overflow-wrap:anywhere]'
                : !active
                  ? 'text-[12px] leading-[1.28] line-clamp-2 [overflow-wrap:anywhere]'
                  : 'truncate text-[13px] leading-[1.35]',
              done && 'font-medium text-muted-foreground',
              cancelled && 'font-medium text-text-dim line-through',
            )}
          >
            {task.title}
          </span>
        )}
        {/* AI summary indicator — manual refine placeholder OR an auto-regeneration on status change */}
        {(task.summarizing || task.summary === REFINING) && (
          <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-muted-foreground">
            <Sparkles size={11} className="spk-twinkle" /> 总结中…
          </span>
        )}
        {titleGenerating && (
          <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-brand">
            <Spinner size={11} /> 标题生成中…
          </span>
        )}
        {/* compact (inactive-column) live cards: keep room for the title; only overdue gets an icon. */}
        {!active && isLive && <CompactOverdueIcon ddl={task.ddl} />}
        {/* ▷启动 — v7 .kcard-go: quiet muted marker (icon + 启动), success only on hover; collapse-only, live cards */}
        {!open && active && isLive && task.summary !== REFINING && (
          <button
            title="为此任务起会话"
            className="inline-flex h-[18px] flex-none items-center gap-[3px] rounded px-1.5 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-success"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch?.(task.id)
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
            statuses={statuses}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            onSetStatus={onSetStatus}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onGenerateTitle={onGenerateTitle}
            titleGenerating={titleGenerating}
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
          <DdlChip task={task} onSetDdl={onSetDdl} />
          <span className="flex-1" />
          <MoreMenu
            task={task}
            priorities={priorities}
            statuses={statuses}
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            onSetStatus={onSetStatus}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onGenerateTitle={onGenerateTitle}
            titleGenerating={titleGenerating}
            onDelete={onDelete}
          />
        </div>
      )}

      {/* expanded: summary + linked sessions — full-bleed block with a top border (design .kcard-exp) */}
      {open && (
        <div className="border-t border-border bg-brand/[0.04] px-[13px] py-2.5">
          {!task.summary && !task.summarizing && (isLive || onOpenContext) && (
            <div className="mb-1.5 flex items-center gap-2">
              {isLive && (
                // No 进展摘要 yet — let the user trigger the (merged) generation directly.
                <button
                  ref={moreBtnRef}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetailOpen((v) => !v)
                  }}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
                >
                  <Sparkles size={12} /> 生成进展小结
                </button>
              )}
              <span className="flex-1" />
              {onOpenContext && (
                <button
                  type="button"
                  title="打开任务上下文"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenContext(task)
                  }}
                  className="flex-none rounded p-0.5 text-text-dim hover:bg-secondary hover:text-brand"
                >
                  <FileText size={13} />
                </button>
              )}
            </div>
          )}
          {task.summarizing ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <ExpLabel className="mb-0">进展摘要</ExpLabel>
                <span className="flex-1" />
                {onOpenContext && (
                  <button
                    type="button"
                    title="打开任务上下文"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenContext(task)
                    }}
                    className="flex-none rounded p-0.5 text-text-dim hover:bg-secondary hover:text-brand"
                  >
                    <FileText size={13} />
                  </button>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Sparkles size={12} className="spk-twinkle" /> 港务助手生成中…
              </p>
            </>
          ) : task.summary ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <ExpLabel className="mb-0">进展摘要</ExpLabel>
                <span className="flex-1" />
                {onOpenContext && (
                  <button
                    type="button"
                    title="打开任务上下文"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenContext(task)
                    }}
                    className="flex-none rounded p-0.5 text-text-dim hover:bg-secondary hover:text-brand"
                  >
                    <FileText size={13} />
                  </button>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">{task.summary}</p>
              <button
                ref={moreBtnRef}
                onClick={(e) => {
                  e.stopPropagation()
                  setDetailOpen((v) => !v)
                }}
                className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline"
              >
                更多 <ChevronRight size={11} />
              </button>
            </>
          ) : null}
          {detailOpen && (
            <TaskSummaryPopover anchor={moreBtnRef} taskId={task.id} onClose={() => setDetailOpen(false)} onGenerated={reload} />
          )}
          {linkN > 0 ? (
            <>
              <div className="mt-2.5 mb-1 flex items-center gap-2">
                <ExpLabel className="mb-0">关联会话</ExpLabel>
                {isLive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onLaunch?.(task.id)
                    }}
                    className="inline-flex items-center gap-1 rounded border border-dashed border-brand/50 px-1.5 py-0.5 text-[11px] font-medium text-brand hover:border-brand hover:bg-brand/[0.06]"
                  >
                    <Play size={11} /> 起会话
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {task.links!.map((l) => (
                  <button
                    key={l.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSession?.(l)
                    }}
                    className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1 text-left hover:border-muted-foreground"
                  >
                    <ShipGlyph status={l.status} />
                    <CliBadge cli={l.cli} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={imagePathPlaceholderText(l.title)}>{imagePathPlaceholderText(l.title)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : isLive ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onLaunch?.(task.id)
              }}
              className="mt-2 flex items-center gap-1 rounded border border-dashed border-brand/50 px-2 py-1 text-[12px] text-brand hover:border-brand hover:bg-brand/[0.06]"
            >
              <Play size={12} /> 起会话
            </button>
          ) : (
            <p className="mt-2 text-[11.5px] italic text-text-dim">{cancelled ? '已取消 · 无关联会话' : '已交付 · 会话已停泊归档'}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Small uppercase section label inside the card expansion (v7 .exp-label). */
function ExpLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-1 text-[10px] font-bold uppercase tracking-wide text-text-dim', className)}>{children}</div>
  )
}

export function CliBadge({ cli }: { cli: string }) {
  const tone =
    cli === 'claude' ? 'bg-brand/15 text-brand' : cli === 'codex' ? 'bg-success/15 text-success' : 'bg-purple/15 text-purple'
  return <span className={cn('flex-none rounded px-1.5 py-0.5 text-[10.5px] font-medium', tone)}>{cli}</span>
}

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

function MoreMenu({ task, priorities, statuses, className, ...actions }: { task: Task; priorities: string[]; statuses: string[]; className: string } & MenuActions) {
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
        <TaskMenu task={task} priorities={priorities} statuses={statuses} anchor={btnRef} onClose={() => setOpen(false)} {...actions} />
      )}
    </button>
  )
}

/** Full task menu: 状态 / 优先级 / 智能标题 / 删除. */
function TaskMenu({
  task,
  priorities,
  statuses,
  anchor,
  onClose,
  onSetStatus,
  onSetPriority,
  onGenerateTitle,
  titleGenerating,
  onDelete,
}: {
  task: Task
  priorities: string[]
  statuses: string[]
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
      {statuses.map((s) => {
        const Icon = statusMeta(s).icon
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
      <MenuItem disabled={titleGenerating} onClick={pick(() => onGenerateTitle?.(task.id))}>
        {titleGenerating ? <Spinner size={13} className="text-brand" /> : <Sparkles size={13} className="flex-none text-muted-foreground" />}
        {titleGenerating ? '标题生成中…' : '智能生成任务标题'}
      </MenuItem>
      <MenuItem danger onClick={pick(() => onDelete?.(task.id))}>
        <Trash2 size={13} className="flex-none" /> 删除
      </MenuItem>
    </AnchoredPopover>
  )
}
