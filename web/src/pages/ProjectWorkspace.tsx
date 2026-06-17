import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Play, Sparkles, MoreHorizontal, Anchor } from 'lucide-react'
import { Kanban } from '@/components/workspace/Kanban'
import { SessionModule } from '@/components/workspace/SessionModule'
import { CargoDefaults } from '@/components/workspace/CargoDefaults'
import { SAMPLE_TASKS, SAMPLE_PIN, SAMPLE_CWD_GROUPS, SAMPLE_CARGO } from '@/data/sample'
import { useUI } from '@/lib/ui-store'
import { NewTaskDialog, refineTitle } from '@/components/NewTaskDialog'
import type { Task } from '@/lib/types'

/**
 * Project workspace (the hub) — v7 layout: sticky header + 港湾概览,
 * then 任务(航线) kanban hero, 会话(船只) module, 默认装载 registry.
 * Data is canonical sample for now; /api wiring lands in a later phase.
 */
let taskSeq = 100

export function ProjectWorkspace() {
  const { id = 'Berth' } = useParams()
  const { openLaunch, openDrawer, newTask, setNewTask } = useUI()
  const [tasks, setTasks] = useState<Task[]>(SAMPLE_TASKS)

  const done = tasks.filter((t) => t.status === '已完成').length
  const total = tasks.length
  const inProgress = tasks.filter((t) => t.status === '进行中').length
  const pct = Math.round((done / total) * 100)

  const launch = (t: string) => openLaunch(t ? { dest: 'task', taskTitle: t } : { dest: 'free' })
  const openSession = (t: string) =>
    openDrawer({ title: t, cli: 'claude', cwd: '~/Code/berth', status: 'sail' })

  // 即时创建：card appears NOW; if AI-summarize, refine title + summary in background.
  const createTask = (raw: string, opts: { aiSummarize: boolean; runNow: boolean }) => {
    const tid = `new-${++taskSeq}`
    const card: Task = {
      id: tid,
      title: raw,
      status: opts.runNow ? '进行中' : '待办',
      priority: 'P2',
      summary: opts.aiSummarize ? '港务助手正在总结进展摘要…' : undefined,
      links: opts.runNow ? [{ cli: 'claude', title: raw, status: 'sail' }] : [],
    }
    setTasks((ts) => [card, ...ts])
    if (opts.runNow) openSession(raw)
    if (opts.aiSummarize) {
      setTimeout(() => {
        const { title, summary } = refineTitle(raw)
        setTasks((ts) => ts.map((t) => (t.id === tid ? { ...t, title, summary } : t)))
      }, 2000)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[17px] font-bold text-foreground">{id}</h1>
            <span className="font-mono text-[12px] text-muted-foreground">~/Code/berth</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewTask(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground"
            >
              <Plus size={14} /> 新建任务
            </button>
            <HBtn icon={<Play size={13} />} onClick={() => launch('')}>起会话</HBtn>
            <HBtn icon={<Sparkles size={13} />}>小结</HBtn>
            <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent">
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* rollup */}
        <div className="mt-2.5 flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>
            任务进展 <span className="font-semibold text-foreground">{done}/{total}</span>
          </span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <span>{pct}%</span>
          <span className="ml-2">进行中 <span className="font-semibold text-priority">{inProgress}</span></span>
          <span className="ml-2">最近活动 <span className="text-foreground">12分钟前</span></span>
        </div>

        {/* 港湾概览 */}
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
          <Anchor size={14} className="text-brand" />
          <span className="text-[12px] font-semibold text-foreground">港湾概览</span>
          <Pill tone="success">在跑 2</Pill>
          <Pill tone="brand">靠岸·待查收 1</Pill>
          <Pill tone="warning">今日交付 1/3</Pill>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        {/* 任务 — hero */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-brand">任务</h2>
            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10.5px] font-medium text-brand">航线</span>
          </div>
          <Kanban tasks={tasks} onLaunch={launch} onOpenSession={openSession} />
        </section>

        <SessionModule pin={SAMPLE_PIN} groups={SAMPLE_CWD_GROUPS} onLaunch={() => launch('')} onOpen={openSession} />
        <CargoDefaults dirs={SAMPLE_CARGO} />
      </div>

      <NewTaskDialog open={newTask} onClose={() => setNewTask(false)} onCreate={createTask} />
    </div>
  )
}

function HBtn({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
      {icon}
      {children}
    </button>
  )
}

function Pill({ children, tone }: { children: ReactNode; tone: 'success' | 'brand' | 'warning' }) {
  const dot = tone === 'success' ? 'bg-success' : tone === 'brand' ? 'bg-brand' : 'bg-warning'
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}
