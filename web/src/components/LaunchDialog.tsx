import { useEffect, useMemo, useRef, useState } from 'react'
import { Anchor, ChevronDown, Play, Plus } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, usePastedImages } from './ImagePaste'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { shortCwd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { api, type AgentCli } from '@/lib/api'
import { initCargo, toggleDir, anchorDir, setCode, deriveLaunch, type CargoState } from '@/lib/launch-cargo'

/**
 * 装载台 / 起航 — destination (任务 | 自由提问) + 货舱 (三级上下文开关 + 统一目录列表)。
 * 目录列表：勾选 = 装载 (--add-dir)；⚓ 点亮其一 = 启动目录 (cwd)，不点 = 默认启动目录 (workspace)。
 * 代码上下文主开关关闭 = 默认目录、无 --add-dir。docsRoot 由服务端隐式挂载，不在此 UI。
 * 起航 → opens the session drawer with a fresh /pty launch.
 */
export function LaunchDialog() {
  const { launch, closeLaunch, openDrawer } = useUI()
  const { projects, agents, sessions, addPending, reload } = useData()
  const [dest, setDest] = useState<'task' | 'free'>('task')
  const [cli, setCli] = useState<AgentCli>('claude')
  const [freeText, setFreeText] = useState('')
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const [cargo, setCargo] = useState<CargoState | null>(null)
  const [adjust, setAdjust] = useState(false)
  const [extraDir, setExtraDir] = useState('')
  const prevLaunch = useRef<typeof launch>(null)

  const project = projects.find((p) => p.id === launch?.projectId)
  const enabledAgents = useMemo(() => agents.list.filter((a) => a.enabled), [agents.list])
  const selectedAgent = enabledAgents.find((a) => a.cli === cli) ?? enabledAgents[0]
  const enabledPaths = useMemo(() => (project?.pathsMeta ?? []).filter((p) => p.enabled).map((p) => p.cwd), [project])

  useEffect(() => {
    if (launch && prevLaunch.current !== launch) {
      const hasTask = launch.taskTitle ? launch.dest === 'task' : false
      setDest(launch.taskTitle ? launch.dest : 'free')
      setFreeText('')
      clearImages()
      setAdjust(false)
      setExtraDir('')
      setCargo(initCargo(enabledPaths, project?.lastCwd ?? null, hasTask))
    }
    prevLaunch.current = launch
  }, [launch, clearImages, enabledPaths, project])

  useEffect(() => {
    setCli((prev) => (enabledAgents.some((a) => a.cli === prev) ? prev : enabledAgents[0]?.cli ?? 'claude'))
  }, [enabledAgents])

  if (!launch) return null
  const taskTitle = launch.taskTitle
  const title = dest === 'task' && taskTitle ? taskTitle : freeText || '新会话'
  // We can always sail when there's a project (server falls back to its workspace dir). Only a
  // project-less launch with no resolvable cwd is blocked.
  const canSail = (!!launch.projectId || enabledPaths.length > 0) && !!selectedAgent

  const addExtraDir = async () => {
    const cwd = extraDir.trim()
    if (!cwd || !launch?.projectId || !cargo) return
    try {
      await api.addPath(launch.projectId, cwd, { enabled: true })
      reload() // 重拉项目，新目录进 pathsMeta
      setCargo({ ...cargo, dirs: [...cargo.dirs, { cwd, loaded: true }] }) // 乐观加入并默认装载
      setExtraDir('')
    } catch {
      /* add-path 校验失败（路径不存在等）→ 静默，不阻断 */
    }
  }

  const sail = () => {
    if (!canSail || !selectedAgent) return
    const d = cargo ? deriveLaunch(cargo) : { cwd: '', addDirs: [] as string[], ctxProject: true, ctxTask: dest === 'task' }
    const cwd = d.cwd // '' → server workspace fallback
    const cwdLabel = cwd ? shortCwd(cwd) : '项目默认目录'
    const pendingCwd = cwd || project?.workspaceCwd || ''
    // Stable across the fresh Terminal's dev StrictMode effect replay; the server uses it to attach
    // duplicate /pty?new=1 requests to the first live PTY instead of spawning twice. Also the
    // placeholder's stable key until the real session id arrives.
    const launchToken = crypto.randomUUID()
    closeLaunch()
    // Optimistic placeholder so the launch shows in the lists instantly (创建中…) — the data layer
    // polls /api/refresh until the real session surfaces, then drops this.
    addPending({
      tempId: launchToken,
      cli: selectedAgent.cli,
      cwd: pendingCwd,
      cwdLabel,
      projectId: launch.projectId ?? null,
      todoKey: launch.todoKey ?? null,
      sessionId: null,
      knownIds: pendingCwd ? sessions.filter((s) => s.cli === selectedAgent.cli && (s.cwd ?? '') === pendingCwd).map((s) => s.sessionId) : [],
      createdAt: Date.now(),
    })
    openDrawer({
      title,
      cli: selectedAgent.cli,
      cwd: cwdLabel,
      status: 'sail',
      task: dest === 'task' ? taskTitle : undefined,
      launch: {
        cli: selectedAgent.cli,
        cwd,
        launchToken,
        projectId: launch.projectId,
        todoKey: launch.todoKey,
        prompt: dest === 'free' ? freeText || undefined : undefined,
        images: dest === 'free' ? images : undefined,
        addDirs: d.addDirs,
        ctxProject: d.ctxProject,
        ctxTask: dest === 'task' ? d.ctxTask : false,
      },
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
          <div className="flex min-w-0 gap-4 text-[13px]">
            <Radio checked={dest === 'task'} onClick={() => setDest('task')} className="min-w-0 flex-1">
              任务：{taskTitle ?? '选择任务…'}
            </Radio>
            <Radio checked={dest === 'free'} onClick={() => setDest('free')} className="shrink-0">
              自由提问
            </Radio>
          </div>
          {dest === 'free' && (
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onPaste={onPasteImages}
              rows={2}
              placeholder="想让 agent 做什么…（可粘贴图片）"
              className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
            />
          )}
          {dest === 'free' && <PastedImageStrip images={images} onRemove={removeImage} className="mt-2" />}
        </div>

        {/* Agent */}
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
                    onClick={() => setCli(a.cli)}
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

        {/* 货舱 */}
        {cargo && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">货舱</div>
            <div className={cn('rounded-md border border-border', adjust && 'bg-background/30')}>
              <button
                onClick={() => setAdjust((v) => !v)}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px]', adjust && 'border-b border-border')}
              >
                <span className="flex-1 truncate text-muted-foreground">{cargoSummary(cargo, dest)}</span>
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                  高级 <ChevronDown size={13} className={cn('transition-transform', adjust && 'rotate-180')} />
                </span>
              </button>

              {adjust && (
                <div className="flex flex-col gap-3.5 p-3">
                  {/* 上下文注入 */}
                  <div>
                    <div className="mb-2 text-[11px] font-semibold text-muted-foreground">上下文注入</div>
                    <Check on={cargo.ctxProject} onClick={() => setCargo({ ...cargo, ctxProject: !cargo.ctxProject })}>项目上下文（Berth）</Check>
                    {dest === 'task' && (
                      <Check on={cargo.ctxTask} onClick={() => setCargo({ ...cargo, ctxTask: !cargo.ctxTask })} className="mt-2">任务上下文</Check>
                    )}
                  </div>

                  {/* 代码上下文 */}
                  <div className={cn(!cargo.codeOn && 'opacity-50')}>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                      代码上下文
                      <button
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
                                  <button onClick={() => setCargo(toggleDir(cargo, d.cwd))} className="flex items-center">
                                    <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded border', d.loaded ? 'border-brand bg-brand text-brand-foreground' : 'border-border')}>
                                      {d.loaded && <Check2 />}
                                    </span>
                                  </button>
                                  <button onClick={() => setCargo(toggleDir(cargo, d.cwd))} className={cn('flex-1 truncate text-left font-mono text-[12px]', d.loaded ? 'text-foreground' : 'text-text-dim')}>
                                    {shortCwd(d.cwd)}
                                  </button>
                                  {d.loaded && (
                                    <button
                                      onClick={() => setCargo(anchorDir(cargo, d.cwd))}
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
                            <button onClick={addExtraDir} disabled={!extraDir.trim()} className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] text-brand disabled:opacity-40">
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
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        {!canSail && <span className="mr-auto text-[11px] text-warning">{enabledAgents.length === 0 ? '请先在设置页启用启动 Agent' : '无项目上下文，请从某个项目里起航'}</span>}
        <button onClick={closeLaunch} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
          取消
        </button>
        <button
          onClick={sail}
          disabled={!canSail}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground disabled:opacity-50"
        >
          <Play size={13} /> 起航
        </button>
      </div>
    </Dialog>
  )
}

function cargoSummary(s: CargoState, dest: 'task' | 'free'): string {
  const ctxCount = (s.ctxProject ? 1 : 0) + (dest === 'task' && s.ctxTask ? 1 : 0) + (s.codeOn ? 1 : 0)
  const d = deriveLaunch(s)
  const start = d.cwd ? shortCwd(d.cwd) : '默认'
  const extra = d.addDirs.length ? ` · 装载 +${d.addDirs.length}` : ''
  return `上下文 ${ctxCount} 项 · 启动 ${start}${extra}`
}

function Check({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-2.5 text-[12.5px]', on ? 'text-card-foreground' : 'text-text-dim', className)}>
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

function Radio({ checked, onClick, children, className }: { checked: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-1.5 text-foreground', className)}>
      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand' : 'border-border')}>
        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  )
}
