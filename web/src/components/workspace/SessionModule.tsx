import { useState } from 'react'
import { Pin, ChevronDown, ChevronRight, Play, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionRow, CwdGroup } from '@/lib/types'
import { CliBadge } from './TaskCard'

function Glyph({ status }: { status: SessionRow['status'] }) {
  if (status === 'sail') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-transparent ring-1 ring-brand" />
  return <span className="h-1.5 w-1.5 flex-none" /> // moored/idle — empty gutter, keeps alignment
}

function Row({ s, showCwd, onOpen }: { s: SessionRow; showCwd?: boolean; onOpen?: (s: SessionRow) => void }) {
  return (
    <button
      onClick={() => onOpen?.(s)}
      className="group flex h-[34px] w-full items-center gap-2 rounded px-2 text-left hover:bg-sidebar-accent"
    >
      <Glyph status={s.status} />
      <CliBadge cli={s.cli} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{s.title}</span>
      {s.linkedTask && (
        <span className="hidden items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground group-hover:inline-flex">
          <Link2 size={10} /> 已关联任务
        </span>
      )}
      {showCwd && <span className="flex-none font-mono text-[11px] text-text-dim">{s.cwd}</span>}
      <span className="flex-none text-[11px] text-text-dim">{s.time}</span>
    </button>
  )
}

function CwdSection({ group, onOpen }: { group: CwdGroup; onOpen?: (s: SessionRow) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [more, setMore] = useState(false)
  const LIMIT = 4
  const visible = more ? group.sessions : group.sessions.slice(0, LIMIT)
  const hidden = group.sessions.length - LIMIT

  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="font-mono">{group.cwd}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{group.tag}</span>
        <span className="ml-auto">{group.sessions.length}</span>
      </button>
      {!collapsed && (
        <div className="flex flex-col">
          {visible.map((s) => (
            <Row key={s.id} s={s} onOpen={onOpen} />
          ))}
          {hidden > 0 && (
            <button
              onClick={() => setMore((v) => !v)}
              className="ml-[38px] py-1 text-left text-[11px] font-medium text-text-dim hover:text-brand"
            >
              {more ? '收起' : `展开更多 (${hidden})`}
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
  onOpen,
}: {
  pin: SessionRow[]
  groups: CwdGroup[]
  onLaunch?: () => void
  onOpen?: (s: SessionRow) => void
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">会话</h2>
        <span className="rounded-full bg-purple/15 px-1.5 py-0.5 text-[10.5px] font-medium text-purple">船只</span>
        <button
          onClick={onLaunch}
          className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-foreground hover:bg-accent"
        >
          <Play size={12} /> 起会话
        </button>
      </div>

      {/* Pin section — keeps cwd visible (not grouped by cwd) */}
      <div className="mt-2">
        <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-muted-foreground">
          <Pin size={12} /> Pin <span className="ml-auto">{pin.length}</span>
        </div>
        {pin.map((s) => (
          <Row key={s.id} s={s} showCwd onOpen={onOpen} />
        ))}
      </div>

      {/* cwd groups */}
      <div className="mt-1 flex flex-col gap-1">
        {groups.map((g) => (
          <CwdSection key={g.cwd} group={g} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}
