import { useEffect, useMemo, useState } from 'react'
import { Anchor, Box, Folder, Play } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, usePastedImages } from './ImagePaste'
import { useUI } from '@/lib/ui-store'
import { useData } from '@/lib/data'
import { shortCwd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AgentCli } from '@/lib/api'

/**
 * 装载台 / 起航 — destination (任务 | 自由提问) + the spawn-cwd resolver:
 *  - 0 enabled 货舱  → 项目默认目录 (Berth workspace; cwd sent empty, server resolves + mkdirs)
 *  - 1 enabled 货舱  → that dir (static)
 *  - ≥2 enabled 货舱 → radio list, auto-lit = sticky lastCwd else first enabled; user can switch
 * 起航 → opens the session drawer with a fresh /pty launch.
 */
export function LaunchDialog() {
  const { launch, closeLaunch, openDrawer } = useUI()
  const { projects, agents, sessions, addPending } = useData()
  const [dest, setDest] = useState<'task' | 'free'>('task')
  const [cli, setCli] = useState<AgentCli>('claude')
  const [freeText, setFreeText] = useState('')
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const [pickedCwd, setPickedCwd] = useState<string | null>(null)

  const project = projects.find((p) => p.id === launch?.projectId)
  const enabledAgents = useMemo(() => agents.list.filter((a) => a.enabled), [agents.list])
  const selectedAgent = enabledAgents.find((a) => a.cli === cli) ?? enabledAgents[0]
  const enabledPaths = useMemo(() => (project?.pathsMeta ?? []).filter((p) => p.enabled).map((p) => p.cwd), [project])
  const autoPick = useMemo(
    () => (project?.lastCwd && enabledPaths.includes(project.lastCwd) ? project.lastCwd : enabledPaths[0]),
    [project, enabledPaths],
  )
  const selectedCwd = pickedCwd ?? autoPick // undefined when 0 enabled → workspace fallback

  useEffect(() => {
    if (launch) {
      setDest(launch.taskTitle ? launch.dest : 'free')
      setCli((prev) => (enabledAgents.some((a) => a.cli === prev) ? prev : enabledAgents[0]?.cli ?? 'claude'))
      setFreeText('')
      clearImages()
      setPickedCwd(null)
    }
  }, [launch, enabledAgents, clearImages])

  if (!launch) return null
  const taskTitle = launch.taskTitle
  const title = dest === 'task' && taskTitle ? taskTitle : freeText || '新会话'
  // We can always sail when there's a project (server falls back to its workspace dir). Only a
  // project-less launch with no resolvable cwd is blocked.
  const canSail = (!!launch.projectId || enabledPaths.length > 0) && !!selectedAgent

  const sail = () => {
    if (!canSail || !selectedAgent) return
    const cwd = enabledPaths.length === 0 ? '' : selectedCwd || '' // '' → server workspace fallback
    const cwdLabel = cwd ? shortCwd(cwd) : '项目默认目录'
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
      cwd,
      cwdLabel,
      projectId: launch.projectId ?? null,
      todoKey: launch.todoKey ?? null,
      sessionId: null,
      knownIds: cwd ? sessions.filter((s) => s.cli === selectedAgent.cli && (s.cwd ?? '') === cwd).map((s) => s.sessionId) : [],
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

        {/* 启动目录 */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">启动目录</div>
          {enabledPaths.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-[12.5px]">
              <Box size={14} className="text-purple" />
              <span className="text-foreground">项目默认目录</span>
              <span className="ml-auto text-[10.5px] text-text-dim">自动 · 未登记货舱</span>
            </div>
          ) : enabledPaths.length === 1 ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-[12.5px]">
              <Folder size={14} className="text-brand" />
              <span className="font-mono text-foreground">{shortCwd(enabledPaths[0])}</span>
              <span className="ml-auto text-[10.5px] text-text-dim">自动 · 唯一装载</span>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {enabledPaths.map((cwd) => {
                const on = selectedCwd === cwd
                return (
                  <button
                    key={cwd}
                    onClick={() => setPickedCwd(cwd)}
                    className={cn(
                      'flex w-full items-center gap-2.5 border-t border-border/55 px-2.5 py-2 text-left first:border-t-0',
                      on ? 'bg-brand/10' : 'hover:bg-accent',
                    )}
                  >
                    <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border', on ? 'border-brand' : 'border-border')}>
                      {on && <span className="h-2 w-2 rounded-full bg-brand" />}
                    </span>
                    <span className="font-mono text-[12px] text-foreground">{shortCwd(cwd)}</span>
                    {on && <span className="ml-auto text-[10px] text-brand">{pickedCwd ? '已选' : '自动选中'}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
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
