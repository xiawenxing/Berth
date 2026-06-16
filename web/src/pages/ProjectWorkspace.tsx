import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Play, Sparkles, MoreHorizontal, Anchor } from 'lucide-react'

/**
 * Project workspace (the hub). Scaffold shell with the v7 structure in place —
 * sticky header + 港湾概览 + 任务 / 会话 / 默认装载 section frames. Real content
 * (kanban active-column, cards, session module, cargo) lands in P1+.
 */
export function ProjectWorkspace() {
  const { id = 'Berth' } = useParams()

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* sticky header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[17px] font-bold text-foreground">{id}</h1>
            <span className="font-mono text-[12px] text-muted-foreground">~/Code/berth</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground">
              <Plus size={14} /> 新建任务
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
              <Play size={13} /> 起会话
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
              <Sparkles size={13} /> 小结
            </button>
            <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent">
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>
        {/* 港湾概览 */}
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
          <Anchor size={14} className="text-brand" />
          <Pill tone="success">在跑 2</Pill>
          <Pill tone="brand">靠岸·待查收 1</Pill>
          <Pill tone="warning">今日交付 1/3</Pill>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        <SectionFrame title="任务" tag="航线" />
        <SectionFrame title="会话" tag="船只" />
        <SectionFrame title="默认装载" />
        <p className="text-[12px] text-text-dim">
          脚手架已就绪（React + Vite + 午夜靛蓝）。任务看板 / 会话模块 / 装载台 / 抽屉将按
          docs/mockups/berth-2.0/v7-project.html 在后续阶段填充。
        </p>
      </div>
    </div>
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

function SectionFrame({ title, tag }: { title: string; tag?: string }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {tag && (
          <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10.5px] font-medium text-brand">{tag}</span>
        )}
      </div>
      <div className="mt-3 text-[12px] text-text-dim">（占位 — 待填充）</div>
    </section>
  )
}
