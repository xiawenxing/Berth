import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Anchor, ChevronDown, Play } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, usePastedImages } from './ImagePaste'
import { LaunchConfigFields } from './LaunchConfigFields'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { cn } from '@/lib/utils'
import { api, type AgentCli, type ApiTask } from '@/lib/api'
import { initCargo, type CargoState } from '@/lib/launch-cargo'
import { filterTaskOptions } from '@/lib/task-picker'
import { startFreshLaunch } from '@/lib/launch-runner'
import { loadLastAgent, saveLastAgent } from '@/lib/agent-preference'
import { clearDraft, draftKey, readDraft, writeDraft } from '@/lib/draft-storage'

/**
 * 装载台 / 起航 — destination (由入口决定) + 货舱 (三级上下文开关 + 统一目录列表)。
 * 目录列表：勾选 = 装载 (--add-dir)；⚓ 点亮其一 = 启动目录 (cwd)，不点 = 默认启动目录 (workspace)。
 * 代码上下文主开关关闭 = 默认目录、无 --add-dir。docsRoot 由服务端隐式挂载，不在此 UI。
 * 起航 → opens the session drawer with a fresh /pty launch.
 */
export function LaunchDialog() {
  const { launch, closeLaunch, openDrawer } = useUI()
  const { projects, agents, sessions, tasks, addPending, resolvePending, reload, resync } = useData()
  const [dest, setDest] = useState<'task' | 'free'>('task')
  const [cli, setCli] = useState<AgentCli>(() => loadLastAgent() ?? 'claude')
  const [freeText, setFreeText] = useState('')
  const [taskNote, setTaskNote] = useState('')
  // When 起航 is opened without a preset task, the user picks one here (title + todoKey).
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null)
  const [taskQuery, setTaskQuery] = useState('')
  const [taskSelectOpen, setTaskSelectOpen] = useState(false)
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const [cargo, setCargo] = useState<CargoState | null>(null)
  const [adjust, setAdjust] = useState(false)
  const [extraDir, setExtraDir] = useState('')
  const prevLaunch = useRef<typeof launch>(null)

  const project = projects.find((p) => p.id === launch?.projectId)
  const enabledAgents = useMemo(() => agents.list.filter((a) => a.enabled), [agents.list])
  const selectedAgent = enabledAgents.find((a) => a.cli === cli) ?? enabledAgents[0]
  const enabledPaths = useMemo(() => (project?.pathsMeta ?? []).filter((p) => p.enabled).map((p) => p.cwd), [project])
  const launchDraftKey = launch ? draftKey(`launch:${launch.projectId ?? 'none'}:${launch.todoKey ?? 'free'}`) : null

  useEffect(() => {
    if (launch && prevLaunch.current !== launch) {
      const hasTask = launch.taskTitle ? launch.dest === 'task' : false
      setDest(launch.taskTitle ? 'task' : launch.dest)
      const saved = readDraft(draftKey(`launch:${launch.projectId ?? 'none'}:${launch.todoKey ?? 'free'}`))
      setFreeText(launch.dest === 'free' ? saved : '')
      setTaskNote(launch.dest === 'task' ? saved : '')
      clearImages()
      setAdjust(false)
      setExtraDir('')
      setPicked(null)
      setTaskQuery('')
      setTaskSelectOpen(false)
      setCargo(initCargo(enabledPaths, project?.lastCwd ?? null, hasTask))
    }
    prevLaunch.current = launch
  }, [launch, clearImages, enabledPaths, project])

  useEffect(() => {
    setCli((prev) => (enabledAgents.some((a) => a.cli === prev) ? prev : enabledAgents[0]?.cli ?? 'claude'))
  }, [enabledAgents])

  // Persist the user's pick globally (most-recent-wins) so the next launch — in any project — defaults to it.
  const selectCli = useCallback((c: AgentCli) => {
    setCli(c)
    saveLastAgent(c)
  }, [])

  // Switching destination starts a clean slate: drop pasted images and clear the field we're leaving
  // (so nothing bleeds across modes). We don't touch draft storage, so reopening the dialog restores it.
  const changeDest = (next: 'task' | 'free') => {
    if (next === dest) return
    clearImages()
    if (dest === 'free') setFreeText('')
    else setTaskNote('')
    setTaskSelectOpen(false)
    setDest(next)
  }

  if (!launch) return null
  // A task can come pre-selected (launched from a task card) or be chosen here via the picker.
  const presetTask = !!launch.taskTitle
  const taskTitle = launch.taskTitle ?? picked?.title
  const todoKey = presetTask ? launch.todoKey : picked?.id
  const taskOptions = presetTask ? [] : filterTaskOptions(tasks, launch.projectId, taskQuery)
  const title = dest === 'task' && taskTitle ? taskTitle : freeText || '新会话'
  // We can always sail when there's a project (server falls back to its workspace dir). Only a
  // project-less launch with no resolvable cwd is blocked.
  const canSail = (!!launch.projectId || enabledPaths.length > 0) && !!selectedAgent && (dest === 'free' || !!taskTitle)

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
    if (launchDraftKey) clearDraft(launchDraftKey)
    closeLaunch()
    startFreshLaunch({
      dest,
      title,
      cli: selectedAgent.cli,
      cargo,
      project,
      projectId: launch.projectId,
      todoKey,
      taskTitle,
      taskNote,
      freeText,
      images,
      sessions,
      addPending,
      resolvePending,
      resync,
      openDrawer,
    })
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (launchDraftKey) clearDraft(launchDraftKey)
        closeLaunch()
      }}
      width={560}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Anchor size={15} className="text-brand" />
        <h3 className="text-[13px] font-semibold text-foreground">起航</h3>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* 目的地 */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">目的地</div>
          <div className="flex min-w-0 gap-4 text-[13px]">
            {presetTask ? (
              <DestinationLabel className="min-w-0 flex-1">
                任务：{taskTitle ?? '选择任务…'}
              </DestinationLabel>
            ) : (
              <>
                <Radio checked={dest === 'task'} onClick={() => changeDest('task')} className="min-w-0 flex-1">
                  任务：{taskTitle ?? '选择任务…'}
                </Radio>
                <Radio checked={dest === 'free'} onClick={() => changeDest('free')} className="shrink-0">
                  自由提问
                </Radio>
              </>
            )}
          </div>
          {dest === 'task' && !presetTask && (
            <TaskSelect
              value={picked}
              open={taskSelectOpen}
              query={taskQuery}
              options={taskOptions}
              onOpenChange={setTaskSelectOpen}
              onQueryChange={setTaskQuery}
              onPick={(task) => {
                setPicked({ id: task.id, title: task.title })
                setTaskQuery('')
                setTaskSelectOpen(false)
              }}
            />
          )}
          {dest === 'free' && (
            <textarea
              value={freeText}
              onChange={(e) => {
                setFreeText(e.target.value)
                if (launchDraftKey) writeDraft(launchDraftKey, e.target.value)
              }}
              onPaste={(e) => onPasteImages(e, {
                value: freeText,
                setValue: (next) => {
                  setFreeText(next)
                  if (launchDraftKey) writeDraft(launchDraftKey, next)
                },
                target: e.currentTarget,
              })}
              rows={2}
              placeholder="想让 agent 做什么…（可粘贴图片）"
              className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
            />
          )}
          {dest === 'free' && <PastedImageStrip images={images} onRemove={removeImage} className="mt-2" />}
          {dest === 'task' && taskTitle && (
            <textarea
              value={taskNote}
              onChange={(e) => {
                setTaskNote(e.target.value)
                if (launchDraftKey) writeDraft(launchDraftKey, e.target.value)
              }}
              onPaste={(e) => onPasteImages(e, {
                value: taskNote,
                setValue: (next) => {
                  setTaskNote(next)
                  if (launchDraftKey) writeDraft(launchDraftKey, next)
                },
                target: e.currentTarget,
              })}
              rows={3}
              placeholder="补充本次会话的额外背景、范围或具体要求…（可粘贴图片）"
              className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
            />
          )}
          {dest === 'task' && taskTitle && <PastedImageStrip images={images} onRemove={removeImage} className="mt-2" />}
        </div>

        <LaunchConfigFields
          dest={dest}
          cargo={cargo}
          setCargo={setCargo}
          enabledAgents={enabledAgents}
          selectedCli={selectedAgent?.cli ?? cli}
          onSelectCli={selectCli}
          enabledPaths={enabledPaths}
          adjust={adjust}
          setAdjust={setAdjust}
          extraDir={extraDir}
          setExtraDir={setExtraDir}
          onAddExtraDir={addExtraDir}
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        {!canSail && (
          <span className="mr-auto text-[11px] text-warning">
            {enabledAgents.length === 0
              ? '请先在设置页启用启动 Agent'
              : dest === 'task' && !taskTitle
                ? '请先选择一个任务'
                : '无项目上下文，请从某个项目里起航'}
          </span>
        )}
        <button
          onClick={() => {
            if (launchDraftKey) clearDraft(launchDraftKey)
            closeLaunch()
          }}
          className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent"
        >
          取消
        </button>
        <button
          onClick={sail}
          disabled={!canSail}
          className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold"
        >
          <Play size={13} /> 起航
        </button>
      </div>
    </Dialog>
  )
}

function DestinationLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-foreground ${className ?? ''}`}>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-brand">
        <span className="h-2 w-2 rounded-full bg-brand" />
      </span>
      <span className="truncate">{children}</span>
    </div>
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

function TaskSelect({
  value,
  open,
  query,
  options,
  onOpenChange,
  onQueryChange,
  onPick,
}: {
  value: { id: string; title: string } | null
  open: boolean
  query: string
  options: ApiTask[]
  onOpenChange: (open: boolean) => void
  onQueryChange: (query: string) => void
  onPick: (task: ApiTask) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const openPicker = () => {
    onQueryChange('')
    onOpenChange(true)
  }

  return (
    <div
      className="relative mt-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOpenChange(false)
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? onOpenChange(false) : openPicker())}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-ring',
          !value && 'text-text-dim',
        )}
      >
        <span className="min-w-0 flex-1 truncate" title={value?.title}>
          {value?.title ?? '选择任务…'}
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-text-dim transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="anim-pop absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-md border border-border bg-popover p-1 shadow-lg">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onOpenChange(false)
              }
              if (e.key === 'Enter' && options[0]) {
                e.preventDefault()
                onPick(options[0])
              }
            }}
            placeholder="搜索任务…"
            role="combobox"
            aria-expanded={open}
            className="mb-1 w-full rounded border border-border bg-card px-2.5 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
          />
          <div role="listbox" className="max-h-44 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-[12px] text-text-dim">
                {query.trim() ? '没有匹配的任务' : '该项目暂无可选任务'}
              </div>
            ) : (
              options.map((t) => {
                const selected = value?.id === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(t)}
                    className={cn(
                      'flex w-full items-center rounded px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                      selected ? 'bg-brand/10 text-foreground' : 'text-foreground hover:bg-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                        selected ? 'border-brand' : 'border-border',
                      )}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-brand" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={t.title}>
                      {t.title}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
