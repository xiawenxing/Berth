import { useMemo, useState } from 'react'
import { Search, FolderInput, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { Terminal } from '@/components/Terminal'
import { useData, relTime, shortCwd } from '@/lib/data'
import { useLive } from '@/lib/live'
import { SHIP_LABEL, type ShipStatus } from '@/lib/types'
import type { ApiSession } from '@/lib/api'

function Glyph({ status }: { status: ShipStatus }) {
  if (status === 'sail') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-transparent ring-1 ring-brand" />
  return <span className="h-1.5 w-1.5 flex-none" />
}

function match(s: ApiSession, q: string) {
  if (!q) return true
  const t = q.toLowerCase()
  return (
    (s.title || '').toLowerCase().includes(t) ||
    (s.cwd || '').toLowerCase().includes(t) ||
    s.cli.toLowerCase().includes(t)
  )
}

export function Unassigned() {
  const { sessions } = useData()
  const live = useLive()
  const [selId, setSelId] = useState<string | null>(null)
  const [q, setQ] = useState('')

  // Unassigned = sessions with no projectId, grouped by raw cwd.
  const groups = useMemo(() => {
    const m = new Map<string, ApiSession[]>()
    for (const s of sessions) {
      if (s.projectId) continue
      const key = s.cwd || ''
      const arr = m.get(key)
      if (arr) arr.push(s)
      else m.set(key, [s])
    }
    return [...m.entries()].map(([cwd, list]) => ({
      cwd,
      sessions: list.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  }, [sessions])

  const allUnassigned = useMemo(() => groups.flatMap((g) => g.sessions), [groups])
  // First real unassigned session selected by default; fall back if selection vanished.
  const sel =
    allUnassigned.find((s) => s.sessionId === selId) ?? allUnassigned[0] ?? null

  const select = (s: ApiSession) => {
    setSelId(s.sessionId)
    live.markSeen(s.sessionId)
  }

  return (
    <div className="flex h-full">
      {/* left persistent list */}
      <div className="flex w-[332px] flex-none flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
            <Search size={13} className="text-text-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题 / cwd / CLI"
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-dim"
            />
          </div>
          <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent" title="导入目录">
            <FolderInput size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {allUnassigned.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-muted-foreground">没有无归属会话</p>
          ) : (
            groups.map((g) => (
              <CwdGroup
                key={g.cwd || '__no_cwd__'}
                cwd={g.cwd}
                sessions={g.sessions.filter((s) => match(s, q))}
                selId={sel?.sessionId}
                onSelect={select}
              />
            ))
          )}
        </div>
      </div>

      {/* right session content */}
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        {sel ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <CliBadge cli={sel.cli} />
              <span className="truncate text-[13px] font-semibold text-foreground">{sel.title || sel.sessionId}</span>
              <span className="font-mono text-[11px] text-text-dim">{shortCwd(sel.cwd)}</span>
              {(() => {
                const st = live.shipStatus(sel.sessionId, sel.updatedAt)
                return (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10.5px]',
                      st === 'sail'
                        ? 'bg-success/15 text-success'
                        : st === 'dock'
                          ? 'bg-brand/15 text-brand'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {SHIP_LABEL[st]}
                  </span>
                )
              })()}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Terminal key={sel.sessionId} sessionId={sel.sessionId} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function CwdGroup({
  cwd,
  sessions,
  selId,
  onSelect,
}: {
  cwd: string
  sessions: ApiSession[]
  selId?: string
  onSelect: (s: ApiSession) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [more, setMore] = useState(false)
  const live = useLive()
  if (sessions.length === 0) return null
  const LIMIT = 4
  const visible = more ? sessions : sessions.slice(0, LIMIT)
  const hidden = sessions.length - LIMIT
  const label = shortCwd(cwd) || '(无 cwd)'
  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="font-mono">{label}</span>
        <span className="ml-auto">{sessions.length}</span>
      </button>
      {!collapsed && (
        <div>
          {visible.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => onSelect(s)}
              className={cn(
                'relative flex h-[46px] w-full items-center gap-2 px-3 text-left hover:bg-sidebar-accent',
                selId === s.sessionId &&
                  'bg-sidebar-accent before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-brand',
              )}
            >
              <Glyph status={live.shipStatus(s.sessionId, s.updatedAt)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{s.title || s.sessionId}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <CliBadge cli={s.cli} />
                  <span className="truncate font-mono text-[11px] text-text-dim">{shortCwd(s.cwd)}</span>
                </div>
              </div>
              <span className="flex-none text-[11px] text-text-dim">{relTime(s.updatedAt)}</span>
            </button>
          ))}
          {hidden > 0 && (
            <button
              onClick={() => setMore((v) => !v)}
              className="px-3 py-1 pl-[34px] text-left text-[11px] font-medium text-text-dim hover:text-brand"
            >
              {more ? '收起' : `展开更多 (${hidden})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
