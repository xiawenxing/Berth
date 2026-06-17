import { useState, type ReactNode } from 'react'
import { FileText, Folder, GitBranch, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CargoDir } from '@/lib/types'

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'flex h-5 w-9 flex-none items-center rounded-full px-0.5 transition-colors',
        on ? 'bg-success/70' : 'bg-muted',
      )}
    >
      <span className={cn('h-4 w-4 rounded-full bg-card-foreground transition-transform', on && 'translate-x-4')} />
    </button>
  )
}

function RegRow({
  icon: Icon,
  name,
  sub,
  right,
}: {
  icon: typeof Folder
  name: string
  sub?: string
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
      <Icon size={14} className="flex-none text-muted-foreground" />
      <span className="text-[13px] text-foreground">{name}</span>
      {sub && <span className="font-mono text-[11px] text-text-dim">{sub}</span>}
      <span className="flex-1" />
      {right}
    </div>
  )
}

export function CargoDefaults({ dirs }: { dirs: CargoDir[] }) {
  const [state, setState] = useState(dirs)
  const toggle = (i: number) => setState((s) => s.map((d, j) => (j === i ? { ...d, on: !d.on } : d)))

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">默认装载</h2>
        <span className="ml-auto text-[11px] text-text-dim">起航自动装载，不必每次选</span>
      </div>

      {/* 上下文文档 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">上下文文档</div>
        <div className="flex flex-col gap-1.5">
          <RegRow icon={FileText} name="项目上下文 (Berth)" sub="projects/Berth/index.md" right={<Toggle on onChange={() => {}} />} />
          <RegRow icon={FileText} name="任务上下文 · 进展 6 条" sub="tasks/pin-cwd-grouping/index.md" />
        </div>
      </div>

      {/* 代码上下文 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">代码上下文 (cwd / worktree)</div>
        <div className="flex flex-col gap-1.5">
          {state.map((d, i) => (
            <RegRow
              key={d.path}
              icon={d.kind === 'worktree' ? GitBranch : Folder}
              name={d.path}
              sub={d.label}
              right={<Toggle on={d.on} onChange={() => toggle(i)} />}
            />
          ))}
          <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground hover:border-brand hover:text-brand">
            <Plus size={13} /> 添加目录
          </button>
        </div>
      </div>
    </section>
  )
}
