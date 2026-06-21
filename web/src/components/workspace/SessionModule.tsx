import { useState, type ReactNode } from 'react'
import { Pin, ChevronDown, Anchor, Terminal, Play, Link2, RefreshCw, Box, FolderInput } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHIP_LABEL, type SessionRow, type CwdGroup, type ShipStatus } from '@/lib/types'
import { CliBadge } from './TaskCard'

const SHIP_TONE: Record<ShipStatus, string> = {
  sail: 'bg-success/15 text-success',
  dock: 'bg-brand/15 text-brand',
  moored: 'bg-muted-foreground/15 text-muted-foreground', // faint tint, not the solid muted surface
}

function Glyph({ status }: { status: SessionRow['status'] }) {
  if (status === 'sail') return <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-success" title="在航" />
  if (status === 'dock') return <span className="h-2 w-2 flex-none rounded-full border-2 border-brand" title="靠岸·待查收" />
  return <span className="h-2 w-2 flex-none" /> // moored/idle — empty gutter keeps alignment
}

/** A session row — faithful to v7 .srow: glyph · cli · title · ship pill · linked · cwd(right) ·
 *  time · hover actions(pin). Whole row opens the session; the pin toggle stops propagation. */
function Row({
  s,
  showCwd,
  onOpen,
  onPin,
}: {
  s: SessionRow
  showCwd?: boolean
  onOpen?: (s: SessionRow) => void
  onPin?: (id: string, nextOn: boolean) => void
}) {
  const ship: ShipStatus = s.status === 'idle' ? 'moored' : s.status
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
        <Glyph status={s.status} />
      </span>
      <CliBadge cli={s.cli} />
      <span className="max-w-[280px] flex-none truncate text-[13px] font-medium text-foreground">{s.title}</span>
      <span className={cn('inline-flex flex-none items-center rounded px-1.5 py-px text-[10.5px] font-semibold', SHIP_TONE[ship])}>
        {SHIP_LABEL[ship]}
      </span>
      {s.linkedTask && (
        <span className="inline-flex flex-none items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10px] text-text-dim">
          <Link2 size={10} /> 已关联任务
        </span>
      )}
      {/* cwd: right-aligned, fills the gap (mirrors v7 .s-cwd flex:1 text-align:right) */}
      <span className={cn('min-w-[30px] flex-1 truncate text-right font-mono text-[11px] text-text-dim', !showCwd && 'opacity-0')}>
        {showCwd ? s.cwd : ''}
      </span>
      <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">{s.time}</span>
      {/* hover actions (pin) — pinned stays lit even off-hover */}
      <div className="flex flex-none items-center">
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
          <Pin size={12} className={cn(s.pinned && 'fill-current')} />
        </button>
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
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [more, setMore] = useState(false)
  const limited = limit != null && rows.length > limit
  const visible = limited && !more ? rows.slice(0, limit) : rows
  const hidden = rows.length - visible.length

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] font-semibold text-muted-foreground hover:bg-accent"
      >
        <ChevronDown size={13} className={cn('flex-none text-text-dim transition-transform', collapsed && '-rotate-90')} />
        {icon}
        <span className={cn('inline-flex items-center gap-1.5 text-foreground', labelMono ? 'font-mono text-[11.5px]' : 'text-[12px]')}>
          {label}
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
      </button>
      {!collapsed && (
        <div>
          {visible.map((s) => (
            <Row key={s.id} s={s} showCwd={showCwd} onOpen={onOpen} onPin={onPin} />
          ))}
          {limited && (
            <button
              onClick={() => setMore((v) => !v)}
              className="ml-[38px] flex items-center gap-1 py-1.5 text-left text-[11px] font-medium text-text-dim hover:text-muted-foreground"
            >
              <ChevronDown size={12} />
              {more ? 'Show less' : `Show more (${hidden})`}
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
  onLaunch,
  onResync,
  syncing,
  onOpen,
  onPin,
  onImport,
}: {
  pin: SessionRow[]
  groups: CwdGroup[]
  onLaunch?: () => void
  onResync?: () => void
  syncing?: boolean
  onOpen?: (s: SessionRow) => void
  onPin?: (id: string, nextOn: boolean) => void
  onImport?: (rawCwd: string) => void // 导入某 cwd 组目录下磁盘上的其他会话
}) {
  const empty = pin.length === 0 && groups.length === 0
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
            {pin.length > 0 && (
              <Section
                icon={<Pin size={12} className="flex-none text-priority" />}
                label="Pin"
                count={pin.length}
                rows={pin}
                showCwd
                onOpen={onOpen}
                onPin={onPin}
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
                />
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}
