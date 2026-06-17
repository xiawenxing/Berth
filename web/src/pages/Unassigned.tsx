import { useState } from 'react'
import { Search, FolderInput, ChevronDown, ChevronRight, Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { SessionChat } from '@/components/SessionChat'
import { SHIP_LABEL, type ShipStatus } from '@/lib/types'

interface USession {
  id: string
  cli: string
  title: string
  cwd: string
  time: string
  status: ShipStatus
}

// One cwd group has 6 sessions to exercise show-more (4 shown + 2 hidden).
const GROUPS: { cwd: string; sessions: USession[] }[] = [
  {
    cwd: '~/scratch',
    sessions: [
      { id: 'u1', cli: 'claude', title: '调研 xterm 主题', cwd: '~/scratch', time: '1天前', status: 'moored' },
      { id: 'u6', cli: 'claude', title: '快速验证 oklch 配色', cwd: '~/scratch', time: '1天前', status: 'moored' },
      { id: 'u7', cli: 'codex', title: '试 react-router hash 模式', cwd: '~/scratch', time: '2天前', status: 'moored' },
      { id: 'u8', cli: 'coco', title: '看一段 vite 配置', cwd: '~/scratch', time: '2天前', status: 'moored' },
      { id: 'u9', cli: 'claude', title: 'tailwind v4 @theme 试验', cwd: '~/scratch', time: '3天前', status: 'moored' },
      { id: 'u10', cli: 'codex', title: '草稿：抽屉动画', cwd: '~/scratch', time: '4天前', status: 'moored' },
    ],
  },
  { cwd: '~/tmp/rename', sessions: [{ id: 'u2', cli: 'codex', title: '临时脚本 重命名批处理', cwd: '~/tmp/rename', time: '2天前', status: 'dock' }] },
  { cwd: '~/Downloads', sessions: [{ id: 'u3', cli: 'coco', title: '看一段日志', cwd: '~/Downloads', time: '3天前', status: 'moored' }] },
  { cwd: '~/.berth/scratch', sessions: [{ id: 'u4', cli: 'claude', title: '写周报', cwd: '~/.berth/scratch · 默认cwd', time: '4天前', status: 'moored' }] },
  { cwd: '~/Code/sandbox', sessions: [{ id: 'u5', cli: 'codex', title: '测试 codex hook', cwd: '~/Code/sandbox', time: '上周', status: 'moored' }] },
]

function Glyph({ status }: { status: ShipStatus }) {
  if (status === 'sail') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-transparent ring-1 ring-brand" />
  return <span className="h-1.5 w-1.5 flex-none" />
}

export function Unassigned() {
  const [sel, setSel] = useState<USession>(GROUPS[0].sessions[0])
  const [q, setQ] = useState('')
  const [running, setRunning] = useState(false)

  return (
    <div className="flex h-full">
      {/* left persistent list */}
      <div className="flex w-[332px] flex-none flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
            <Search size={13} className="text-text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题 / cwd / CLI" className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-dim" />
          </div>
          <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent" title="导入目录"><FolderInput size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {GROUPS.map((g) => (
            <CwdGroup key={g.cwd} cwd={g.cwd} sessions={g.sessions.filter((s) => match(s, q))} sel={sel} onSelect={(s) => { setSel(s); setRunning(s.status === 'sail') }} />
          ))}
        </div>
      </div>

      {/* right session content */}
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <CliBadge cli={sel.cli} />
          <span className="truncate text-[13px] font-semibold text-foreground">{sel.title}</span>
          <span className="font-mono text-[11px] text-text-dim">{sel.cwd}</span>
          <span className={cn('rounded-full px-1.5 py-0.5 text-[10.5px]', sel.status === 'sail' ? 'bg-success/15 text-success' : sel.status === 'dock' ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground')}>{SHIP_LABEL[sel.status]}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><SessionChat firstUser={sel.title} /></div>
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-md border border-border bg-card p-2">
            <textarea placeholder="输入消息发送给 agent…" rows={2} className="min-h-0 flex-1 resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-dim" />
            {running ? (
              <button onClick={() => setRunning(false)} className="flex flex-none items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-[12px] font-semibold text-brand-foreground"><Square size={12} /> 终止</button>
            ) : (
              <button className="flex flex-none items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground"><Send size={12} /> 发送</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function match(s: USession, q: string) {
  if (!q) return true
  const t = q.toLowerCase()
  return s.title.toLowerCase().includes(t) || s.cwd.toLowerCase().includes(t) || s.cli.includes(t)
}

function CwdGroup({ cwd, sessions, sel, onSelect }: { cwd: string; sessions: USession[]; sel: USession; onSelect: (s: USession) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [more, setMore] = useState(false)
  if (sessions.length === 0) return null
  const LIMIT = 4
  const visible = more ? sessions : sessions.slice(0, LIMIT)
  const hidden = sessions.length - LIMIT
  return (
    <div>
      <button onClick={() => setCollapsed((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground">
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="font-mono">{cwd}</span>
        <span className="ml-auto">{sessions.length}</span>
      </button>
      {!collapsed && (
        <div>
          {visible.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={cn('relative flex h-[46px] w-full items-center gap-2 px-3 text-left hover:bg-sidebar-accent', sel.id === s.id && 'bg-sidebar-accent before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-brand')}
            >
              <Glyph status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{s.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <CliBadge cli={s.cli} />
                  <span className="truncate font-mono text-[11px] text-text-dim">{s.cwd}</span>
                </div>
              </div>
              <span className="flex-none text-[11px] text-text-dim">{s.time}</span>
            </button>
          ))}
          {hidden > 0 && (
            <button onClick={() => setMore((v) => !v)} className="px-3 py-1 pl-[34px] text-left text-[11px] font-medium text-text-dim hover:text-brand">
              {more ? '收起' : `展开更多 (${hidden})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
