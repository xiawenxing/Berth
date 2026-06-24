import { Anchor, ChevronDown, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentCli, AgentEntry } from '@/lib/api'
import { shortCwd } from '@/lib/format'
import { anchorDir, deriveLaunch, setCode, toggleDir, type CargoState } from '@/lib/launch-cargo'
import { cn } from '@/lib/utils'

export function LaunchConfigFields({
  dest,
  cargo,
  setCargo,
  enabledAgents,
  selectedCli,
  onSelectCli,
  enabledPaths,
  adjust,
  setAdjust,
  extraDir,
  setExtraDir,
  onAddExtraDir,
}: {
  dest: 'task' | 'free'
  cargo: CargoState | null
  setCargo: (cargo: CargoState) => void
  enabledAgents: AgentEntry[]
  selectedCli: AgentCli
  onSelectCli: (cli: AgentCli) => void
  enabledPaths: string[]
  adjust: boolean
  setAdjust: (v: boolean | ((prev: boolean) => boolean)) => void
  extraDir: string
  setExtraDir: (v: string) => void
  onAddExtraDir: () => void
}) {
  const selectedAgent = enabledAgents.find((a) => a.cli === selectedCli) ?? enabledAgents[0]
  return (
    <>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Agent</div>
        {enabledAgents.length === 0 ? (
          <div className="rounded-md border border-warning/50 bg-warning/10 px-2.5 py-2 text-[12px] text-warning">
            设置页里没有启用任何启动 Agent
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {enabledAgents.map((a) => {
              const on = selectedAgent?.cli === a.cli
              return (
                <button
                  key={a.cli}
                  type="button"
                  onClick={() => onSelectCli(a.cli)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]',
                    on ? 'border-brand bg-brand/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span className="font-semibold">{a.cli}</span>
                  <span className="font-mono text-[10.5px] text-text-dim">
                    {a.cli === 'coco' ? '无 --model' : a.model || 'CLI 默认模型'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {cargo && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">货舱</div>
          <div className={cn('rounded-md border border-border', adjust && 'bg-background/30')}>
            <button
              type="button"
              onClick={() => setAdjust((v) => !v)}
              aria-expanded={adjust}
              className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px]', adjust && 'border-b border-border')}
            >
              <span className="flex-1 truncate text-muted-foreground">{cargoSummary(cargo, dest)}</span>
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                高级 <ChevronDown size={13} className={cn('transition-transform', adjust && 'rotate-180')} />
              </span>
            </button>

            {adjust && (
              <div className="flex flex-col gap-3.5 p-3">
                <div>
                  <div className="mb-2 text-[11px] font-semibold text-muted-foreground">上下文注入</div>
                  <Check on={cargo.ctxProject} onClick={() => setCargo({ ...cargo, ctxProject: !cargo.ctxProject })}>项目上下文（Berth）</Check>
                  {dest === 'task' && (
                    <Check on={cargo.ctxTask} onClick={() => setCargo({ ...cargo, ctxTask: !cargo.ctxTask })} className="mt-2">任务上下文</Check>
                  )}
                </div>

                <div className={cn(!cargo.codeOn && 'opacity-50')}>
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    代码上下文
                    <button
                      type="button"
                      onClick={() => setCargo(setCode(cargo, !cargo.codeOn))}
                      className={cn('ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium', cargo.codeOn ? 'border-brand bg-brand/15 text-brand' : 'border-border text-muted-foreground')}
                    >
                      {cargo.codeOn ? '装载中' : '已关闭'}
                    </button>
                  </div>
                  <div className={cn(!cargo.codeOn && 'pointer-events-none')}>
                    {enabledPaths.length === 0 ? (
                      <div className="text-[11px] text-text-dim">未登记货舱，仅可起航于项目默认目录</div>
                    ) : (
                      <>
                        <div className="mb-2 text-[10.5px] leading-snug text-text-dim">
                          勾选要装载的目录（走 --add-dir）；点行尾「设为启动」选其一作为启动目录，不点则用默认启动目录。
                        </div>
                        <div className="overflow-hidden rounded-md border border-border">
                          {cargo.dirs.map((d) => {
                            const lit = cargo.litCwd === d.cwd
                            return (
                              <div key={d.cwd} className="flex items-center gap-2.5 border-t border-border/55 px-2.5 py-2 first:border-t-0">
                                <button type="button" onClick={() => setCargo(toggleDir(cargo, d.cwd))} aria-pressed={d.loaded} aria-label={`装载 ${d.cwd}`} className="flex items-center">
                                  <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded border', d.loaded ? 'border-brand bg-brand text-brand-foreground' : 'border-border')}>
                                    {d.loaded && <Check2 />}
                                  </span>
                                </button>
                                <button type="button" onClick={() => setCargo(toggleDir(cargo, d.cwd))} className={cn('flex-1 truncate text-left font-mono text-[12px]', d.loaded ? 'text-foreground' : 'text-text-dim')}>
                                  {shortCwd(d.cwd)}
                                </button>
                                {d.loaded && (
                                  <button
                                    type="button"
                                    onClick={() => setCargo(anchorDir(cargo, d.cwd))}
                                    aria-pressed={lit}
                                    className={cn('flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px]', lit ? 'border-brand bg-brand/12 text-brand' : 'border-border text-muted-foreground hover:bg-accent')}
                                  >
                                    <Anchor size={11} /> {lit ? '启动目录' : '设为启动'}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            value={extraDir}
                            onChange={(e) => setExtraDir(e.target.value)}
                            placeholder="额外目录绝对路径…"
                            className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
                          />
                          <button type="button" onClick={onAddExtraDir} disabled={!extraDir.trim()} className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] text-brand disabled:opacity-40">
                            <Plus size={12} /> 添加
                          </button>
                        </div>
                        <div className="mt-2 text-[11.5px] text-muted-foreground">
                          启动目录：{cargo.litCwd ? <span className="font-mono text-card-foreground">{shortCwd(cargo.litCwd)}</span> : <span className="text-text-dim">默认启动目录</span>}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function cargoSummary(s: CargoState, dest: 'task' | 'free'): string {
  const ctxCount = (s.ctxProject ? 1 : 0) + (dest === 'task' && s.ctxTask ? 1 : 0) + (s.codeOn ? 1 : 0)
  const d = deriveLaunch(s)
  const start = d.cwd ? shortCwd(d.cwd) : '默认'
  const extra = d.addDirs.length ? ` · 装载 +${d.addDirs.length}` : ''
  return `上下文 ${ctxCount} 项 · 启动 ${start}${extra}`
}

function Check({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn('flex items-center gap-2.5 text-[12.5px]', on ? 'text-card-foreground' : 'text-text-dim', className)}>
      <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded border', on ? 'border-brand bg-brand text-brand-foreground' : 'border-border')}>
        {on && <Check2 />}
      </span>
      {children}
    </button>
  )
}

function Check2() {
  return <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 3l2.2 2L8 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
