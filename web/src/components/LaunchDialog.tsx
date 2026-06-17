import { useEffect, useState } from 'react'
import { Anchor, ChevronDown, Package, Play, Plus } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { useUI } from '@/lib/ui-store'
import { SAMPLE_CARGO } from '@/data/sample'
import { cn } from '@/lib/utils'

/**
 * 装载台 / 起航 — unified launch. Destination (任务 | 自由提问) + ONE merged 货舱
 * block (summary line = header, 调整装载 expands the editor inside the same block).
 * 开箱即走: collapsed by default. 起航 → opens the session drawer.
 */
export function LaunchDialog() {
  const { launch, closeLaunch, openDrawer } = useUI()
  const [adjust, setAdjust] = useState(false)
  const [dest, setDest] = useState<'task' | 'free'>('task')
  const [freeText, setFreeText] = useState('')

  useEffect(() => {
    if (launch) {
      setAdjust(false)
      setDest(launch.dest)
      setFreeText('')
    }
  }, [launch])

  if (!launch) return null
  const taskTitle = launch.taskTitle

  const sail = () => {
    closeLaunch()
    openDrawer({
      title: dest === 'task' && taskTitle ? taskTitle : freeText || '新会话',
      cli: 'claude',
      cwd: '~/Code/berth',
      status: 'sail',
      task: dest === 'task' ? taskTitle : undefined,
    })
  }

  return (
    <Dialog open onClose={closeLaunch} width={560}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Anchor size={15} className="text-brand" />
        <h3 className="text-[13px] font-semibold text-foreground">起航</h3>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* 目的地 */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">目的地</div>
          <div className="flex gap-4 text-[13px]">
            <Radio checked={dest === 'task'} onClick={() => setDest('task')}>
              任务：{taskTitle ?? '选择任务…'}
            </Radio>
            <Radio checked={dest === 'free'} onClick={() => setDest('free')}>
              自由提问
            </Radio>
          </div>
          {dest === 'free' && (
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={2}
              placeholder="想让 agent 做什么…"
              className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
            />
          )}
        </div>

        {/* 货舱 — one merged block: summary header + 调整装载 expands editor inside */}
        <div className={cn('rounded-md border border-border', adjust && 'bg-background/30')}>
          <button
            onClick={() => setAdjust((v) => !v)}
            className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left', adjust && 'border-b border-border')}
          >
            <Package size={14} className="text-brand" />
            <span className="text-[13px] text-foreground">
              货舱：项目上下文 · 任务上下文 · 代码上下文 <span className="font-mono text-[12px] text-muted-foreground">~/Code/berth</span> · claude
            </span>
            <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
              {adjust ? '收起装载' : '调整装载'}
              <ChevronDown size={13} className={cn('transition-transform', adjust && 'rotate-180')} />
            </span>
          </button>

          {adjust && (
            <div className="flex flex-col gap-2.5 p-3">
              <Check defaultChecked>项目上下文 (Berth)</Check>
              {dest === 'task' && <Check defaultChecked>任务上下文 · 进展 6 条</Check>}
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">代码上下文（默认装载已登记的目录 · 额外目录走 --add-dir）</div>
                <div className="flex flex-col gap-1.5">
                  {SAMPLE_CARGO.filter((d) => d.on).map((d) => (
                    <Check key={d.path} defaultChecked>
                      <span className="font-mono">{d.path}</span>
                    </Check>
                  ))}
                  <button className="flex items-center gap-1 text-[12px] text-brand hover:underline">
                    <Plus size={12} /> 额外目录…
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <span className="text-muted-foreground">CLI</span>
                <Select options={['claude', 'codex', 'coco']} />
                <span className="text-muted-foreground">模型</span>
                <Select options={['默认']} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button onClick={closeLaunch} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
          取消
        </button>
        <button onClick={sail} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground">
          <Play size={13} /> 起航
        </button>
      </div>
    </Dialog>
  )
}

function Radio({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-foreground">
      <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border', checked ? 'border-brand' : 'border-border')}>
        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      {children}
    </button>
  )
}

function Check({ children, defaultChecked }: { children: React.ReactNode; defaultChecked?: boolean }) {
  const [on, setOn] = useState(!!defaultChecked)
  return (
    <button onClick={() => setOn((v) => !v)} className="flex items-center gap-2 text-[13px] text-foreground">
      <span className={cn('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-brand bg-brand' : 'border-border')}>
        {on && <span className="text-[10px] text-brand-foreground">✓</span>}
      </span>
      {children}
    </button>
  )
}

function Select({ options }: { options: string[] }) {
  return (
    <select className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none">
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  )
}
