import { useEffect, useMemo, useRef, useState } from 'react'
import { Anchor, Play } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, usePastedImages } from './ImagePaste'
import { LaunchConfigFields } from './LaunchConfigFields'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { cn } from '@/lib/utils'
import { api, type AgentCli } from '@/lib/api'
import { initCargo, type CargoState } from '@/lib/launch-cargo'
import { startFreshLaunch } from '@/lib/launch-runner'

/**
 * 装载台 / 起航 — destination (任务 | 自由提问) + 货舱 (三级上下文开关 + 统一目录列表)。
 * 目录列表：勾选 = 装载 (--add-dir)；⚓ 点亮其一 = 启动目录 (cwd)，不点 = 默认启动目录 (workspace)。
 * 代码上下文主开关关闭 = 默认目录、无 --add-dir。docsRoot 由服务端隐式挂载，不在此 UI。
 * 起航 → opens the session drawer with a fresh /pty launch.
 */
export function LaunchDialog() {
  const { launch, closeLaunch, openDrawer } = useUI()
  const { projects, agents, sessions, addPending, resolvePending, reload } = useData()
  const [dest, setDest] = useState<'task' | 'free'>('task')
  const [cli, setCli] = useState<AgentCli>('claude')
  const [freeText, setFreeText] = useState('')
  const [taskNote, setTaskNote] = useState('')
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
      setTaskNote('')
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
    if (cargo.dirs.some((d) => d.cwd === cwd)) { setExtraDir(''); return }
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
    closeLaunch()
    startFreshLaunch({
      dest,
      title,
      cli: selectedAgent.cli,
      cargo,
      project,
      projectId: launch.projectId,
      todoKey: launch.todoKey,
      taskTitle,
      taskNote,
      freeText,
      images,
      sessions,
      addPending,
      resolvePending,
      openDrawer,
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
          {dest === 'task' && taskTitle && (
            <textarea
              value={taskNote}
              onChange={(e) => setTaskNote(e.target.value)}
              rows={3}
              placeholder="补充本次会话的额外背景、范围或具体要求…"
              className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
            />
          )}
        </div>

        <LaunchConfigFields
          dest={dest}
          cargo={cargo}
          setCargo={setCargo}
          enabledAgents={enabledAgents}
          selectedCli={selectedAgent?.cli ?? cli}
          onSelectCli={setCli}
          enabledPaths={enabledPaths}
          adjust={adjust}
          setAdjust={setAdjust}
          extraDir={extraDir}
          setExtraDir={setExtraDir}
          onAddExtraDir={addExtraDir}
        />
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

function Radio({ checked, onClick, children, className }: { checked: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick} role="radio" aria-checked={checked} className={cn('flex items-center gap-1.5 text-foreground', className)}>
      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand' : 'border-border')}>
        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  )
}
