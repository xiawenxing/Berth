import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Play } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, pastedImageDataUrls, usePastedImages, type PastedImage } from './ImagePaste'
import { LaunchConfigFields } from './LaunchConfigFields'
import type { AgentCli, AgentConfig, ApiProject } from '@/lib/api'
import { initCargo, type CargoState } from '@/lib/launch-cargo'
import type { Task } from '@/lib/types'
import { clearDraft, draftKey, readDraft, writeDraft } from '@/lib/draft-storage'
import { loadLastAgent, saveLastAgent } from '@/lib/agent-preference'

/**
 * 新建任务 — minimal immediate-create model: one big title textarea + two small
 * checkboxes (AI 自动总结标题 / 立即执行). 创建 makes a card NOW; if AI-summarize,
 * the card refines its title + fills 进展摘要 in the background (caller does that).
 */
export function NewTaskDialog({
  open,
  onClose,
  onCreate,
  project,
  agents,
  onAddLaunchPath,
}: {
  open: boolean
  onClose: () => void
  onCreate: (raw: string, opts: NewTaskCreateOptions) => void
  project?: ApiProject
  agents?: AgentConfig
  onAddLaunchPath?: (cwd: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [ai, setAi] = useState(true)
  const [run, setRun] = useState(false)
  const [cli, setCli] = useState<AgentCli>(() => loadLastAgent() ?? 'claude')
  const [cargo, setCargo] = useState<CargoState | null>(null)
  const [adjust, setAdjust] = useState(false)
  const [extraDir, setExtraDir] = useState('')
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const ref = useRef<HTMLTextAreaElement>(null)
  const wasOpen = useRef(false)
  const enabledAgents = useMemo(() => agents?.list.filter((a) => a.enabled) ?? [], [agents?.list])
  const selectedAgent = enabledAgents.find((a) => a.cli === cli) ?? enabledAgents[0]
  const enabledPaths = useMemo(() => (project?.pathsMeta ?? []).filter((p) => p.enabled).map((p) => p.cwd), [project])
  const canRun = !run || (!!project?.id && !!selectedAgent)
  const taskDraftKey = draftKey(`new-task:${project?.id ?? 'global'}`)

  useEffect(() => {
    if (open && !wasOpen.current) {
      setText(readDraft(taskDraftKey))
      setAi(true)
      setRun(false)
      setAdjust(false)
      setExtraDir('')
      setCargo(initCargo(enabledPaths, project?.lastCwd ?? null, true))
      clearImages()
      setTimeout(() => ref.current?.focus(), 0)
    }
    wasOpen.current = open
  }, [open, clearImages, enabledPaths, project?.lastCwd, taskDraftKey])

  useEffect(() => {
    setCli((prev) => (enabledAgents.some((a) => a.cli === prev) ? prev : enabledAgents[0]?.cli ?? 'claude'))
  }, [enabledAgents])

  // Persist the user's pick globally (most-recent-wins) so the next launch — in any project — defaults to it.
  const selectCli = useCallback((c: AgentCli) => {
    setCli(c)
    saveLastAgent(c)
  }, [])

  const addExtraDir = async () => {
    const cwd = extraDir.trim()
    if (!cwd || !cargo || !onAddLaunchPath) return
    if (cargo.dirs.some((d) => d.cwd === cwd)) { setExtraDir(''); return }
    const ok = await onAddLaunchPath(cwd)
    if (!ok) return
    setCargo({ ...cargo, dirs: [...cargo.dirs, { cwd, loaded: true }] })
    setExtraDir('')
  }

  const create = () => {
    if (!text.trim() && images.length === 0) return
    if (!canRun) return
    onCreate(text.trim(), {
      aiSummarize: ai,
      runNow: run,
      images: pastedImageDataUrls(images),
      launch: run && selectedAgent ? { cli: selectedAgent.cli, cargo } : undefined,
    })
    clearDraft(taskDraftKey)
    onClose()
  }

  const cancel = () => {
    clearDraft(taskDraftKey)
    onClose()
  }

  return (
    <Dialog open={open} onClose={cancel} width={560}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">新建任务</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{run ? '创建后直接起航 · 配置会随任务一起生效' : '写个标题就走 · 港务助手在后台补全'}</p>
      </div>

      <div className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto p-4">
        <label className="mb-1 block text-[10.5px] text-muted-foreground">任务标题</label>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            writeDraft(taskDraftKey, e.target.value)
          }}
          onPaste={onPasteImages}
          rows={4}
          placeholder="粗略写个标题，或贴一段描述/图片都行"
          className="min-h-24 w-full resize-y rounded-md border border-border bg-card px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
        />
        <PastedImageStrip images={images} onRemove={removeImage} className="mt-2" />
        <div className="mt-2.5 flex flex-wrap gap-4">
          <MiniCheck on={ai} onToggle={() => setAi((v) => !v)} icon={<Sparkles size={12} />}>
            AI 自动总结任务标题
          </MiniCheck>
          <MiniCheck on={run} onToggle={() => setRun((v) => !v)} icon={<Play size={12} />}>
            立即执行
          </MiniCheck>
        </div>
        {run && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <LaunchConfigFields
              dest="task"
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
            {!canRun && (
              <div className="text-[11px] text-warning">
                {enabledAgents.length === 0 ? '请先在设置页启用启动 Agent' : '当前项目还没加载完成，暂不能立即执行'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button onClick={cancel} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
          取消
        </button>
        <button onClick={create} disabled={!canRun} className="btn-primary rounded-md px-3 py-1.5 text-[13px] font-semibold">
          创建
        </button>
      </div>
    </Dialog>
  )
}

function MiniCheck({
  on,
  onToggle,
  icon,
  children,
}: {
  on: boolean
  onToggle: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${on ? 'border-brand bg-brand' : 'border-border'}`}>
        {on && <span className="text-[9px] text-brand-foreground">✓</span>}
      </span>
      <span className={on ? 'text-brand' : 'text-muted-foreground'}>{icon}</span>
      {children}
    </button>
  )
}

/** Refine a raw title to a short one (background-agent simulation). */
export function refineTitle(raw: string): { title: string; summary: string } {
  const firstClause = raw.split(/[，。,.\n]/)[0].trim()
  const title = firstClause.length > 22 ? firstClause.slice(0, 22) + '…' : firstClause
  return { title, summary: raw }
}

export interface NewTaskLaunchConfig { cli: AgentCli; cargo: CargoState | null }
export interface NewTaskCreateOptions { aiSummarize: boolean; runNow: boolean; images: string[]; launch?: NewTaskLaunchConfig }
export type NewTaskResult = { raw: string; opts: NewTaskCreateOptions }
export type { Task }
export type { PastedImage }
