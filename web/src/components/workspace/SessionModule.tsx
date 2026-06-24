import { useRef, useState, type ReactNode } from 'react'
import { Pin, ChevronDown, Anchor, Terminal, Play, Link2, RefreshCw, Box, FolderInput, FolderPlus, Sparkles, MoreHorizontal, Loader2, LogOut, Trash2, Check, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnchoredPopover, MenuItem, MenuLabel } from '@/components/ui/Menu'
import { useLive } from '@/lib/live'
import { SESSION_SHOW_MORE_PAGE } from '@/lib/paging'
import { type SessionRow, type CwdGroup, type ShipStatus } from '@/lib/types'
import { CliBadge } from './TaskCard'

export interface SessionTaskOption {
  id: string
  title: string
}

// One lamp carries the whole status (no redundant text pill): sail=运行中(蓝色 loading), dock=未读(红点),
// moored=已读/idle(无标记，仅保留占位). The word lives in the tooltip; the title's weight/dim reinforces it.
function Glyph({ status }: { status: ShipStatus }) {
  if (status === 'sail') return <Loader2 size={13} className="flex-none animate-spin text-brand" aria-label="在航" />
  if (status === 'dock') return <span className="h-2 w-2 flex-none rounded-full bg-destructive ring-2 ring-destructive/25" title="待查收 · 有未读" />
  // moored=已读/idle: no glyph — the fixed-width slot keeps rows aligned without an empty hollow dot.
  return null
}

/** The linked-task marker — now an interactive control (was a passive label). Linked: a brand tag with
 *  the task title (truncated, full on hover). Unlinked: a hover-revealed ghost「+ 关联任务」. Click opens
 *  a searchable picker (replaces the old ⋯ task dump) + 取消关联 when linked. Lives in the right cluster. */
function TaskTag({
  s,
  tasks,
  onLinkTask,
}: {
  s: SessionRow
  tasks?: SessionTaskOption[]
  onLinkTask: (sessionId: string, taskId: string | null) => Promise<void> | void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const linked = tasks?.find((t) => t.id === s.taskId)
  const isLinked = !!s.taskId
  const close = () => {
    setOpen(false)
    setQ('')
  }
  const pick = (taskId: string | null) => async (e: React.MouseEvent) => {
    e.stopPropagation()
    close()
    await onLinkTask(s.id, taskId)
  }
  const needle = q.trim().toLowerCase()
  const filtered = (tasks ?? []).filter((t) => !needle || t.title.toLowerCase().includes(needle))

  return (
    <>
      <button
        ref={ref}
        type="button"
        title={isLinked ? linked?.title ?? '已关联任务' : '关联到任务'}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          'flex max-w-[160px] flex-none items-center gap-1 rounded-md px-2 py-px text-[10.5px] transition-opacity',
          isLinked
            ? 'border border-brand/30 bg-brand/12 text-brand hover:bg-brand/20'
            : 'border border-dashed border-border text-text-dim opacity-0 hover:border-brand/45 hover:text-brand group-hover:opacity-100',
          open && 'opacity-100',
        )}
      >
        <Link2 size={10} className="flex-none" />
        <span className="truncate">{isLinked ? linked?.title ?? '已关联任务' : '关联任务'}</span>
      </button>
      {open && (
        <AnchoredPopover anchor={ref} width={264} onClose={close}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="搜索任务…"
            className="mb-1.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-brand"
          />
          <MenuLabel>关联任务</MenuLabel>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length ? (
              filtered.map((task) => (
                <MenuItem key={task.id} onClick={pick(task.id)}>
                  <span className={cn('h-1.5 w-1.5 flex-none rounded-full', s.taskId === task.id ? 'bg-brand' : 'bg-transparent')} />
                  <span className="min-w-0 truncate" title={task.title}>{task.title}</span>
                  {s.taskId === task.id && <Check size={13} className="ml-auto flex-none text-brand" />}
                </MenuItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{tasks?.length ? '没有匹配的任务' : '当前项目没有任务'}</div>
            )}
          </div>
          {isLinked && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem danger onClick={pick(null)}>取消关联</MenuItem>
            </>
          )}
        </AnchoredPopover>
      )}
    </>
  )
}

/** A session row — faithful to v7 .srow: glyph · cli · title · ship pill · linked · cwd(right) ·
 *  time · hover actions(pin). Whole row opens the session; the pin toggle stops propagation. */
function Row({
  s,
  showCwd,
  onOpen,
  onPin,
  tasks,
  onGenerateTitle,
  onLinkTask,
  onDetach,
  onUnimport,
}: {
  s: SessionRow
  showCwd?: boolean
  onOpen?: (s: SessionRow) => void
  onPin?: (id: string, nextOn: boolean) => void
  tasks?: SessionTaskOption[]
  onGenerateTitle?: (id: string) => Promise<void> | void
  onLinkTask?: (sessionId: string, taskId: string | null) => Promise<void> | void
  onDetach?: (id: string) => void // 移出项目 (detach → 无归属)
  onUnimport?: (id: string) => void // 取消导入 (remove from Berth's visible set)
}) {
  const live = useLive()
  const ship: ShipStatus = s.status === 'idle' ? 'moored' : s.status
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  // ⋯ menu now holds 标为已读/未读 (always) + 移出项目/取消导入 (when provided). Task-linking moved to TaskTag.

  // An in-flight launch placeholder: not yet a real, openable session — show 创建中… with a spinner
  // and no row actions. It's replaced by the real row the moment the session surfaces (data layer).
  if (s.pending) {
    return (
      <div className="group relative flex h-[34px] items-center gap-2.5 border-t border-border/55 px-3.5 first:border-t-border">
        <span className="flex w-3.5 flex-none items-center justify-center">
          <Loader2 size={12} className="animate-spin text-text-dim" />
        </span>
        <CliBadge cli={s.cli} />
        <span className="min-w-0 flex-[1_1_auto] truncate text-[13px] font-medium text-muted-foreground" title={s.title}>{s.title}</span>
        <span className="inline-flex flex-none items-center rounded bg-muted-foreground/15 px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
          创建中
        </span>
        <span
          className={cn('min-w-[30px] max-w-[240px] flex-[0_1_240px] truncate text-right font-mono text-[11px] text-text-dim', !showCwd && 'opacity-0')}
          title={showCwd && s.cwd ? s.cwd : undefined}
        >
          {showCwd ? s.cwd : ''}
        </span>
        <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">{s.time}</span>
      </div>
    )
  }

  const generateTitle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (generating || !onGenerateTitle) return
    setGenerating(true)
    try {
      await onGenerateTitle(s.id)
    } finally {
      setGenerating(false)
    }
  }

  const markRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    live.markSeen(s.id)
  }
  const markUnread = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    live.markUnread(s.id)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(s)
        }
      }}
      className="group relative flex h-[34px] cursor-pointer items-center gap-2.5 border-t border-border/55 px-3.5 outline-none first:border-t-border hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand"
    >
      <span className="flex w-3.5 flex-none items-center justify-center">
        <Glyph status={ship} />
      </span>
      <CliBadge cli={s.cli} />
      {/* title weight/dim reinforces the lamp: unread(dock)→bold, running(sail)→normal, read(moored)→dim */}
      <span
        className={cn(
          'min-w-0 flex-[1_1_auto] truncate text-[13px]',
          ship === 'dock' ? 'font-semibold text-foreground' : ship === 'moored' ? 'font-normal text-muted-foreground' : 'font-medium text-foreground',
        )}
        title={s.title}
      >
        {s.title}
      </span>
      {/* cwd: right-aligned, fills the gap (mirrors v7 .s-cwd flex:1 text-align:right) */}
      <span
        className={cn('min-w-[30px] max-w-[240px] flex-[0_1_240px] truncate text-right font-mono text-[11px] text-text-dim', !showCwd && 'opacity-0')}
        title={showCwd && s.cwd ? s.cwd : undefined}
      >
        {showCwd ? s.cwd : ''}
      </span>
      {/* 关联任务 — clickable marker in the right cluster (replaces the inline label + ⋯ task dump) */}
      {onLinkTask && <TaskTag s={s} tasks={tasks} onLinkTask={onLinkTask} />}
      <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">{s.time}</span>
      <div className="flex flex-none items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {onGenerateTitle && (
          <button
            type="button"
            title="智能生成标题"
            aria-label="智能生成标题"
            disabled={generating}
            onClick={generateTitle}
            className={cn(
              'flex h-[22px] w-[22px] items-center justify-center rounded text-text-dim transition-opacity hover:bg-secondary hover:text-foreground',
              generating ? 'text-brand opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <Sparkles size={12} className={cn(generating && 'animate-pulse')} />
          </button>
        )}
        <button
          title={s.pinned ? '取消 Pin' : 'Pin 此会话'}
          onClick={(e) => {
            e.stopPropagation()
            onPin?.(s.id, !s.pinned)
          }}
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
            {/* 标为已读 when there's something unread (dock); otherwise offer 标为未读 */}
            {ship === 'dock' ? (
              <MenuItem onClick={markRead}>
                <Check size={13} className="flex-none text-muted-foreground" /> 标为已读
              </MenuItem>
            ) : (
              <MenuItem onClick={markUnread}>
                <CircleDot size={13} className="flex-none text-muted-foreground" /> 标为未读
              </MenuItem>
            )}
            {(onDetach || onUnimport) && (
              <>
                <div className="my-1 border-t border-border" />
                {onDetach && (
                  <MenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      onDetach(s.id)
                    }}
                  >
                    <LogOut size={13} className="flex-none text-muted-foreground" /> 移出项目
                  </MenuItem>
                )}
                {onUnimport && (
                  <MenuItem
                    danger
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      onUnimport(s.id)
                    }}
                  >
                    <Trash2 size={13} className="flex-none" /> 取消导入
                  </MenuItem>
                )}
              </>
            )}
          </AnchoredPopover>
        )}
      </div>
    </div>
  )
}

/** A collapsible section (Pin or a cwd group) with a header and optional show-more. */
function Section({
  icon,
  label,
  labelSuffix,
  labelMono,
  count,
  tag,
  rows,
  showCwd,
  limit,
  onOpen,
  onPin,
  onImport,
  tasks,
  onGenerateTitle,
  onLinkTask,
  onDetach,
  onUnimport,
  onDetachGroup,
  onUnimportGroup,
}: {
  icon: ReactNode
  label: string
  labelSuffix?: string
  labelMono?: boolean
  count: number
  tag?: string
  rows: SessionRow[]
  showCwd?: boolean
  limit?: number
  onOpen?: (s: SessionRow) => void
  onPin?: (id: string, nextOn: boolean) => void
  onImport?: () => void // 导入该目录下磁盘上其他会话 (every group with a rawCwd, incl. the workspace dir)
  tasks?: SessionTaskOption[]
  onGenerateTitle?: (id: string) => Promise<void> | void
  onLinkTask?: (sessionId: string, taskId: string | null) => Promise<void> | void
  onDetach?: (id: string) => void // row 移出项目
  onUnimport?: (id: string) => void // row 取消导入
  onDetachGroup?: (ids: string[]) => void // 移出整组
  onUnimportGroup?: (ids: string[]) => void // 取消导入整组
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [shown, setShown] = useState(limit ?? rows.length)
  const limited = limit != null && rows.length > limit
  const visible = limited ? rows.slice(0, shown) : rows
  const hidden = rows.length - visible.length
  const groupMenuBtnRef = useRef<HTMLSpanElement>(null)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const hasGroupMenu = !!(onDetachGroup || onUnimportGroup)
  const groupIds = rows.map((r) => r.id)

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] font-semibold text-muted-foreground hover:bg-accent"
      >
        <ChevronDown size={13} className={cn('flex-none text-text-dim transition-transform', collapsed && '-rotate-90')} />
        {icon}
        <span
          className={cn('inline-flex min-w-0 flex-[0_1_auto] items-center gap-1.5 text-foreground', labelMono ? 'font-mono text-[11.5px]' : 'text-[12px]')}
          title={label}
        >
          <span className="min-w-0 truncate">{label}</span>
          {labelSuffix && <span className="text-text-dim"> · {labelSuffix}</span>}
        </span>
        <span className="font-normal text-text-dim">{count}</span>
        <span className="flex-1" />
        {tag && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium tracking-wide text-text-dim">{tag}</span>}
        {onImport && (
          <span
            role="button"
            tabIndex={-1}
            title="导入该目录下磁盘上的其他会话"
            onClick={(e) => {
              e.stopPropagation()
              onImport()
            }}
            className="flex-none rounded p-1 text-text-dim hover:bg-secondary hover:text-brand"
          >
            <FolderInput size={13} />
          </span>
        )}
        {hasGroupMenu && (
          <span
            ref={groupMenuBtnRef}
            role="button"
            tabIndex={-1}
            title="该目录的更多操作"
            onClick={(e) => {
              e.stopPropagation()
              setGroupMenuOpen((v) => !v)
            }}
            className="flex-none rounded p-1 text-text-dim hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal size={13} />
          </span>
        )}
      </button>
      {groupMenuOpen && (
        <AnchoredPopover anchor={groupMenuBtnRef} width={184} onClose={() => setGroupMenuOpen(false)}>
          <MenuLabel>该目录</MenuLabel>
          {onDetachGroup && (
            <MenuItem
              onClick={(e) => {
                e.stopPropagation()
                setGroupMenuOpen(false)
                onDetachGroup(groupIds)
              }}
            >
              <LogOut size={13} className="flex-none text-muted-foreground" /> 移出整组（{groupIds.length}）
            </MenuItem>
          )}
          {onUnimportGroup && (
            <MenuItem
              danger
              onClick={(e) => {
                e.stopPropagation()
                setGroupMenuOpen(false)
                onUnimportGroup(groupIds)
              }}
            >
              <Trash2 size={13} className="flex-none" /> 取消导入整组（{groupIds.length}）
            </MenuItem>
          )}
        </AnchoredPopover>
      )}
      {!collapsed && (
        <div>
          {visible.map((s) => (
            <Row
              key={s.id}
              s={s}
              showCwd={showCwd}
              onOpen={onOpen}
              onPin={onPin}
              tasks={tasks}
              onGenerateTitle={onGenerateTitle}
              onLinkTask={onLinkTask}
              onDetach={onDetach}
              onUnimport={onUnimport}
            />
          ))}
          {limited && (
            <button
              onClick={() => {
                if (hidden > 0) setShown((v) => Math.min(v + SESSION_SHOW_MORE_PAGE, rows.length))
                else setShown(limit)
              }}
              className="ml-[38px] flex items-center gap-1 py-1.5 text-left text-[11px] font-medium text-text-dim hover:text-muted-foreground"
            >
              <ChevronDown size={12} />
              {hidden > 0 ? `Show more (${hidden})` : 'Show less'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionModule({
  pin,
  groups,
  pending,
  onLaunch,
  onResync,
  syncing,
  onOpen,
  onPin,
  onImport,
  onImportOther,
  tasks,
  onGenerateTitle,
  onLinkTask,
  onDetach,
  onUnimport,
  onDetachGroup,
  onUnimportGroup,
}: {
  pin: SessionRow[]
  groups: CwdGroup[]
  pending?: SessionRow[] // optimistic in-flight launch placeholders (创建中…)
  onLaunch?: () => void
  onResync?: () => void
  syncing?: boolean
  onOpen?: (s: SessionRow) => void
  onPin?: (id: string, nextOn: boolean) => void
  onImport?: (rawCwd: string) => void // 导入某 cwd 组目录下磁盘上的其他会话
  onImportOther?: () => void // 导入其他（非装载）目录的会话 — pick a folder, then ImportDialog
  tasks?: SessionTaskOption[]
  onGenerateTitle?: (id: string) => Promise<void> | void
  onLinkTask?: (sessionId: string, taskId: string | null) => Promise<void> | void
  onDetach?: (id: string) => void // row 移出项目
  onUnimport?: (id: string) => void // row 取消导入
  onDetachGroup?: (ids: string[], rawCwd?: string) => void // 移出整组
  onUnimportGroup?: (ids: string[], rawCwd?: string) => void // 取消导入整组
}) {
  const pendingRows = pending ?? []
  const empty = pin.length === 0 && groups.length === 0 && pendingRows.length === 0
  return (
    <section className="mt-4">
      {/* secondary "tool" module: dimmed title + neutral tag (contrasts the brand-colored 任务 hero) */}
      <div className="mb-3 flex items-center gap-2">
        <Terminal size={14} className="text-muted-foreground" />
        <h2 className="text-[13px] font-semibold text-muted-foreground">会话</h2>
        <span className="rounded-[10px] bg-muted px-2 py-px text-[11px] font-medium tracking-wide text-muted-foreground">船只</span>
        <span className="flex-1" />
        {onResync && (
          <button
            onClick={onResync}
            disabled={syncing}
            title="同步会话（重新扫描磁盘）"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(syncing && 'animate-spin')} /> 同步
          </button>
        )}
        {onImportOther && (
          <button
            onClick={onImportOther}
            title="从其他目录导入会话（不登记为装载目录）"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-brand"
          >
            <FolderPlus size={12} /> 导入其他目录
          </button>
        )}
        <button
          onClick={onLaunch}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-success"
        >
          <Play size={12} /> 起会话
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
        {empty ? (
          <div className="px-4 py-6 text-center text-[12px] text-text-dim">还没有会话 — 点「起会话」开一个</div>
        ) : (
          <>
            {pendingRows.length > 0 && (
              <Section
                icon={<Loader2 size={12} className="flex-none animate-spin text-text-dim" />}
                label="创建中"
                count={pendingRows.length}
                rows={pendingRows}
                showCwd
              />
            )}
            {pin.length > 0 && (
              <Section
                icon={<Pin size={12} className="flex-none text-priority" />}
                label="Pin"
                count={pin.length}
                rows={pin}
                showCwd
                onOpen={onOpen}
                onPin={onPin}
                tasks={tasks}
                onGenerateTitle={onGenerateTitle}
                onLinkTask={onLinkTask}
                onDetach={onDetach}
                onUnimport={onUnimport}
              />
            )}
            {groups.map((g) => {
              const isWorkspace = g.kind === 'workspace'
              return (
                <Section
                  key={g.key}
                  icon={
                    isWorkspace ? (
                      <Box size={12} className="flex-none text-purple" />
                    ) : (
                      <Anchor size={12} className="flex-none text-brand/60" />
                    )
                  }
                  label={g.cwd}
                  labelSuffix={isWorkspace ? undefined : g.shortTag}
                  labelMono={!isWorkspace}
                  count={g.sessions.length}
                  tag={g.tag}
                  rows={g.sessions}
                  limit={4}
                  onOpen={onOpen}
                  onPin={onPin}
                  onImport={g.rawCwd && onImport ? () => onImport(g.rawCwd!) : undefined}
                  tasks={tasks}
                  onGenerateTitle={onGenerateTitle}
                  onLinkTask={onLinkTask}
                  onDetach={onDetach}
                  onUnimport={onUnimport}
                  onDetachGroup={onDetachGroup ? (ids) => onDetachGroup(ids, g.rawCwd) : undefined}
                  onUnimportGroup={onUnimportGroup ? (ids) => onUnimportGroup(ids, g.rawCwd) : undefined}
                />
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}
