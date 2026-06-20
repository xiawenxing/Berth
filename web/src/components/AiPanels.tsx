import { useEffect, useRef, useState, type RefObject } from 'react'
import { Sparkles, Copy, Save, RefreshCw, X, CheckCircle2, Circle, List, CheckSquare, type LucideIcon } from 'lucide-react'
import { Drawer } from './ui/Overlay'
import { AnchoredPopover } from './ui/Menu'
import { api, type StructuredSummary } from '@/lib/api'

const EMPTY_SUMMARY: StructuredSummary = { headline: '', progress: [], milestones: [] }
const isEmptySummary = (s: StructuredSummary) => !s.headline && !s.progress.length && !s.milestones.length

type SummaryResult = { summary?: StructuredSummary | null; generatedAt?: number; summarizing?: boolean }
type GenerateResult = { summarizing?: boolean; error?: string }

interface SummaryLabels {
  headline: string
  progress: string
  milestones: string
}
const DEFAULT_LABELS: SummaryLabels = { headline: '一句话总结', progress: '进度要点', milestones: '重要里程碑' }

/** 项目小结 — anchored popover over the project context doc. */
export function ProjectSummaryPopover({ anchor, projectId, onClose }: { anchor: RefObject<HTMLElement | null>; projectId: string; onClose: () => void }) {
  return (
    <StructuredSummaryPopover
      anchor={anchor}
      title="项目小结"
      onClose={onClose}
      load={() => api.getProjectSummary(projectId)}
      generate={() => api.projectSummary(projectId)}
    />
  )
}

/** 任务进展详情 — anchored popover behind the task card's 更多 button (headline hidden; the card
 *  already shows the one-line summary, so the popover focuses on detailed progress + TODOs).
 *  Generation is merged: the same run also writes the headline back to the task's 进展摘要 (A field),
 *  so `onGenerated` lets the card refresh that paragraph. */
export function TaskSummaryPopover({ anchor, taskId, onClose, onGenerated }: { anchor: RefObject<HTMLElement | null>; taskId: string; onClose: () => void; onGenerated?: () => void }) {
  return (
    <StructuredSummaryPopover
      anchor={anchor}
      title="进展详情"
      onClose={onClose}
      showHeadline={false}
      labels={{ headline: '一句话总结', progress: '详细进展', milestones: 'TODO' }}
      load={() => api.getTaskSummaryDetail(taskId)}
      generate={() => api.taskSummaryDetail(taskId)}
      onGenerated={onGenerated}
    />
  )
}

/** Anchored popover that renders a StructuredSummary (headline + progress + milestone/TODO). First
 *  open calls `load()` (the persisted cache) and only `generate()`s when none exists yet; the result
 *  is stored server-side so it survives reload. 重新生成 (footer) refreshes on demand. */
function StructuredSummaryPopover({
  anchor,
  title,
  onClose,
  load,
  generate,
  showHeadline = true,
  labels = DEFAULT_LABELS,
  onGenerated,
}: {
  anchor: RefObject<HTMLElement | null>
  title: string
  onClose: () => void
  load: () => Promise<SummaryResult>
  generate: () => Promise<GenerateResult>
  showHeadline?: boolean
  labels?: SummaryLabels
  onGenerated?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<StructuredSummary>(EMPTY_SUMMARY)
  const [generatedAt, setGeneratedAt] = useState<number | undefined>(undefined)
  const [err, setErr] = useState('')
  const aliveRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Footer 重新生成 bridges to the kick() defined inside the effect (which closes over load/generate).
  const setGenRef = useRef<() => void>(() => {})
  const gen = () => setGenRef.current()

  // Generation runs detached server-side; the popover just polls GET until `summarizing` clears, so
  // closing + reopening always reflects the true state (and a run kicked earlier keeps going).
  useEffect(() => {
    aliveRef.current = true
    const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

    const apply = (r: SummaryResult) => {
      if (r.summary != null) { setSummary(r.summary); setGeneratedAt(r.generatedAt) }
    }
    // One poll step: settle (show result, stop, notify) once the server is no longer summarizing.
    const tick = () => {
      load().then((r) => {
        if (!aliveRef.current) return
        if (r.summarizing) { setLoading(true); return }
        stopPoll()
        apply(r)
        setLoading(false)
        onGenerated?.()
      }).catch(() => {})
    }
    const startPoll = () => { stopPoll(); tick(); pollRef.current = setInterval(tick, 2000) }

    const kick = () => {
      setLoading(true)
      setErr('')
      generate()
        .then((r) => {
          if (!aliveRef.current) return
          if (r.error) { setErr(String(r.error)); setLoading(false); return }
          onGenerated?.()   // reload the card list so its 摘要 loading icon lights up via /todos
          startPoll()
        })
        .catch((e) => { if (aliveRef.current) { setErr(String(e)); setLoading(false) } })
    }
    setGenRef.current = kick

    setErr('')
    load()
      .then((r) => {
        if (!aliveRef.current) return
        if (r.summarizing) { apply(r); setLoading(true); startPoll() }   // a run is already in flight
        else if (r.summary != null) { apply(r); setLoading(false) }       // cached, idle
        else kick()                                                       // nothing cached, none running
      })
      .catch(() => { if (aliveRef.current) kick() })

    return () => { aliveRef.current = false; stopPoll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = () => {
    const text = summaryToText(summary, labels)
    if (text) navigator.clipboard?.writeText(text)
  }

  return (
    <AnchoredPopover anchor={anchor} width={340} onClose={onClose}>
      {/* header: title + copy / close (重新生成 lives in the footer, matching the v7 mockup) */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Sparkles size={14} className={loading ? 'spk-twinkle' : 'text-brand'} />
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <span className="flex-1" />
        <button onClick={copy} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="复制">
          <Copy size={13} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭">
          <X size={14} />
        </button>
      </div>

      <div className="-mx-1 max-h-[55vh] overflow-y-auto border-t border-border px-4 py-3">
        {loading ? (
          <p className="flex items-center gap-1.5 py-1 text-[12px] text-muted-foreground">
            <Sparkles size={12} className="spk-twinkle" /> 港务助手生成中…
          </p>
        ) : err ? (
          <p className="text-[12px] text-destructive">{err}</p>
        ) : isEmptySummary(summary) ? (
          <p className="text-[12px] text-muted-foreground">（上下文为空，暂无可总结内容）</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {showHeadline && summary.headline && (
              <Section label={labels.headline} icon={Sparkles} color="text-warning">
                <p className="text-[12.5px] leading-relaxed text-foreground">{summary.headline}</p>
              </Section>
            )}
            {summary.progress.length > 0 && (
              <Section label={labels.progress} icon={List} color="text-success">
                <ul className="flex flex-col gap-1.5">
                  {summary.progress.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-snug text-muted-foreground">
                      <span className="mt-[6px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                      {p}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {summary.milestones.length > 0 && (
              <Section label={labels.milestones} icon={CheckSquare} color="text-brand">
                <ul className="flex flex-col gap-1.5">
                  {summary.milestones.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                      {m.done ? (
                        <CheckCircle2 size={13} className="mt-[1px] flex-none text-success" />
                      ) : (
                        <Circle size={13} className="mt-[1px] flex-none text-text-dim" />
                      )}
                      <span className={m.done ? 'text-muted-foreground line-through' : 'text-foreground'}>{m.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </div>

      {/* footer: 重新生成 + 更新时间 (matches the v7 mockup) */}
      <div className="-mx-1 flex items-center gap-2 border-t border-border bg-card px-3 py-2">
        <button
          onClick={gen}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新生成
        </button>
        <span className="ml-auto text-[10.5px] text-text-dim">
          {generatedAt ? fmtGenerated(generatedAt) : '基于任务与会话进展生成'}
        </span>
      </div>
    </AnchoredPopover>
  )
}

// Section label uses a semantic icon prefix (per the chosen design) rather than a colored dot, so the
// label never reads as a content bullet. The icon carries the section's accent color; the text stays dim.
function Section({ label, icon: Icon, color, children }: { label: string; icon: LucideIcon; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-text-dim">
        <Icon size={13} className={`flex-none ${color}`} />
        {label}
      </div>
      {children}
    </div>
  )
}

/** Flatten a structured summary into plain text for the 复制 button. */
function summaryToText(s: StructuredSummary, labels: SummaryLabels): string {
  const parts: string[] = []
  if (s.headline) parts.push(s.headline)
  if (s.progress.length) parts.push(`\n${labels.progress}:\n` + s.progress.map((p) => `· ${p}`).join('\n'))
  if (s.milestones.length) parts.push(`\n${labels.milestones}:\n` + s.milestones.map((m) => `${m.done ? '[x]' : '[ ]'} ${m.text}`).join('\n'))
  return parts.join('\n').trim()
}

/** "更新于 X" relative label for the cached summary timestamp (ms epoch). */
function fmtGenerated(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return '刚刚更新'
  if (s < 3600) return `${Math.floor(s / 60)}分钟前更新`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前更新`
  return `${Math.floor(s / 86400)}天前更新`
}

export interface ContextDocTarget {
  kind: 'task' | 'project'
  key: string // project name or task id
  path: string // docstore-relative md path
  title: string
}

/** 上下文编辑 — edit the md doc + a bottom input that asks 港务助手 to 整理更新. */
export function ContextDocDrawer({ target, onClose }: { target: ContextDocTarget | null; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [mtime, setMtime] = useState<number | undefined>(undefined)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!target) return
    setNote('')
    setInput('')
    api
      .readDoc(target.path)
      .then((r) => {
        setContent(r.content || '')
        setMtime(r.mtime)
      })
      .catch(() => {
        setContent('')
        setMtime(undefined)
      })
  }, [target])

  const save = () => {
    if (!target) return
    setBusy(true)
    api.saveDoc(target.path, content, mtime).then((r: any) => { if (r?.mtime) setMtime(r.mtime); setNote('已保存') }).catch(() => setNote('保存失败')).finally(() => setBusy(false))
  }
  const aiMerge = () => {
    if (!target || !input.trim()) return
    setBusy(true)
    setNote('')
    api
      .contextUpdate(target.kind, target.key, input.trim())
      .then(() => api.readDoc(target.path))
      .then((r) => {
        setContent(r.content || '')
        setMtime(r.mtime)
        setInput('')
        setNote('港务助手已整理并更新上下文')
      })
      .catch(() => setNote('整理失败'))
      .finally(() => setBusy(false))
  }

  return (
    <Drawer open={!!target} onClose={onClose} width="46vw">
      {target && (
        <>
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-semibold text-foreground">{target.title}</h3>
            <p className="font-mono text-[11px] text-text-dim">{target.path}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-full w-full resize-none rounded-md border border-border bg-card p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2 px-4 pb-1">
            <button onClick={save} disabled={busy} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground hover:bg-accent">
              <Save size={12} /> 保存
            </button>
            {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
          </div>
          <div className="border-t border-border p-3">
            <p className="mb-1 text-[11px] text-text-dim">直接编辑，或在下方写一句，让港务助手整理进上下文</p>
            <div className="flex items-end gap-2 rounded-md border border-border bg-card p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                placeholder="补充点什么，让港务助手整理进上下文…"
                className="min-h-0 flex-1 resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-dim"
              />
              <button
                onClick={aiMerge}
                disabled={busy || !input.trim()}
                className="flex flex-none items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground disabled:opacity-50"
              >
                <Sparkles size={12} className={busy ? 'spk-twinkle' : ''} /> {busy ? '整理中…' : '让 AI 整理更新'}
              </button>
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}
