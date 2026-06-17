import { useState } from 'react'
import { Pin, Play, ChevronDown, CalendarClock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { useUI } from '@/lib/ui-store'
import type { ShipStatus } from '@/lib/types'

interface NowTask {
  proj: string
  title: string
  prio: 'P0' | 'P1' | 'P2'
  delivered?: boolean
  summary: string
  links: { cli: string; title: string; status: ShipStatus }[]
}
interface NowShip {
  proj: string
  cli: string
  title: string
  status: ShipStatus
}

const TODAY: NowTask[] = [
  { proj: 'Berth', title: '废弃全部会话页', prio: 'P0', summary: '先把 无归属/导入/搜索 搬家再删 tab。', links: [{ cli: 'claude', title: 'trust dialog 预置', status: 'moored' }] },
  { proj: 'Berth', title: '会话列表改为 pin + cwd 分组', prio: 'P1', summary: '已确定砍掉活跃/已归档，改为 pin + 按 cwd 分组。', links: [{ cli: 'claude', title: 'Berth 2.0 交互重构讨论', status: 'sail' }, { cli: 'codex', title: '数据层解耦 review', status: 'dock' }] },
  { proj: 'dotfiles', title: '同步 brew', prio: 'P2', summary: '把 Brewfile 与机器现状对齐。', links: [{ cli: 'coco', title: 'brew bundle', status: 'sail' }] },
  { proj: 'Berth', title: 'codex hook trust', prio: 'P1', delivered: true, summary: '已完成并交付。', links: [] },
]

const PIN: NowShip[] = [
  { proj: 'Berth', cli: 'claude', title: 'Berth 2.0 交互重构讨论', status: 'sail' },
  { proj: 'Berth', cli: 'coco', title: 'i18n 文案抽取', status: 'moored' },
]
const UNREAD: NowShip[] = [
  { proj: 'Berth', cli: 'codex', title: '数据层解耦 review', status: 'dock' },
  { proj: 'dotfiles', cli: 'coco', title: 'zsh 插件整理', status: 'dock' },
]
const RUNNING: NowShip[] = [
  { proj: 'dotfiles', cli: 'coco', title: 'brew bundle', status: 'sail' },
  { proj: 'Zhang Shuai conversation', cli: 'claude', title: '会议纪要整理', status: 'sail' },
]

const PRIO_BAR = { P0: 'bg-destructive', P1: 'bg-priority', P2: 'bg-border/70' }

export function Now() {
  const { openDrawer, openLaunch } = useUI()
  const open = (s: { cli: string; title: string; status: ShipStatus }, proj: string) =>
    openDrawer({ title: s.title, cli: s.cli, cwd: proj === 'dotfiles' ? '~/.config' : '~/Code/berth', status: s.status })

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <h1 className="text-[17px] font-bold text-foreground">Now</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">跨项目收件箱</p>
      </header>

      <div className="flex w-full flex-col gap-5 px-6 py-5">
        {/* 今日交付 */}
        <section>
          <SectionHead>今日交付 <span className="text-text-dim">1/4</span></SectionHead>
          <div className="flex flex-col gap-1.5">
            {TODAY.map((t, i) => (
              <TaskRow key={i} t={t} onOpen={open} onLaunch={() => openLaunch({ dest: 'task', taskTitle: t.title })} />
            ))}
          </div>
        </section>

        {/* 船只 */}
        <ShipSection icon={<Pin size={13} />} title="Pin" ships={PIN} onOpen={open} />
        <ShipSection title="未读 · 靠岸·待查收" ships={UNREAD} onOpen={open} />
        <ShipSection title="运行中 · 在航" ships={RUNNING} onOpen={open} />
      </div>
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">{children}</div>
}

function ProjTag({ proj }: { proj: string }) {
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
  ships: NowShip[]
  onOpen: (s: NowShip, proj: string) => void
}) {
  return (
    <section>
      <SectionHead>
        {icon}
        {title} <span className="text-text-dim">{ships.length}</span>
      </SectionHead>
      <div className="flex flex-col">
        {ships.map((s, i) => (
          <button
            key={i}
            onClick={() => onOpen(s, s.proj)}
            className="flex h-[34px] items-center gap-2 rounded px-2 text-left hover:bg-sidebar-accent"
          >
            <ShipGlyph status={s.status} />
            <ProjTag proj={s.proj} />
            <CliBadge cli={s.cli} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{s.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function TaskRow({
  t,
  onOpen,
  onLaunch,
}: {
  t: NowTask
  onOpen: (s: { cli: string; title: string; status: ShipStatus }, proj: string) => void
  onLaunch: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-card">
      <span className={cn('absolute left-0 top-0 h-full w-1', PRIO_BAR[t.prio])} />
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 py-2 pl-3 pr-2 text-left">
        <ProjTag proj={t.proj} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{t.title}</span>
        {t.delivered ? (
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
          <p className="text-[12px] text-muted-foreground">{t.summary}</p>
          {t.links.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {t.links.map((l, i) => (
                <button key={i} onClick={() => onOpen(l, t.proj)} className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1 text-left hover:border-muted-foreground">
                  <ShipGlyph status={l.status} />
                  <CliBadge cli={l.cli} />
                  <span className="truncate text-[12px] text-foreground">{l.title}</span>
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
