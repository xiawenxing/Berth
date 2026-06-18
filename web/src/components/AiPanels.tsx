import { useEffect, useRef, useState, type RefObject } from 'react'
import { Sparkles, Copy, Save, RefreshCw } from 'lucide-react'
import { Drawer } from './ui/Overlay'
import { AnchoredPopover } from './ui/Menu'
import { api } from '@/lib/api'

/** 项目小结 — popover anchored under the 小结 trigger. First open loads the persisted result
 *  (GET /projects/:id/summary) and only generates when none exists yet; the result is stored
 *  server-side so it survives reload. 重新生成 (POST) refreshes and overwrites on demand. */
export function ProjectSummaryPopover({
  anchor,
  projectId,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>
  projectId: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState('')
  const [generatedAt, setGeneratedAt] = useState<number | undefined>(undefined)
  const [err, setErr] = useState('')
  const reqRef = useRef(0)

  const gen = () => {
    const req = ++reqRef.current // ignore stale responses if reopened/regenerated
    setLoading(true)
    setErr('')
    api
      .projectSummary(projectId)
      .then((r) => {
        if (reqRef.current !== req) return
        setSummary(r.summary || '')
        setGeneratedAt(r.generatedAt)
      })
      .catch((e) => {
        if (reqRef.current === req) setErr(String(e))
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false)
      })
  }

  // First open: load the persisted summary; generate only if the project has none yet.
  useEffect(() => {
    const req = ++reqRef.current
    setLoading(true)
    setErr('')
    api
      .getProjectSummary(projectId)
      .then((r) => {
        if (reqRef.current !== req) return
        if (r.summary != null) {
          setSummary(r.summary)
          setGeneratedAt(r.generatedAt)
          setLoading(false)
        } else {
          gen()
        }
      })
      .catch(() => {
        if (reqRef.current === req) gen()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <AnchoredPopover anchor={anchor} width={340} onClose={onClose}>
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles size={14} className={loading ? 'spk-twinkle' : 'text-brand'} />
        <h3 className="text-[13px] font-semibold text-foreground">项目小结</h3>
        {!loading && generatedAt && (
          <span className="text-[11px] text-text-dim">{fmtGenerated(generatedAt)}</span>
        )}
        <span className="flex-1" />
        <button
          onClick={gen}
          disabled={loading}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新生成
        </button>
        <button
          onClick={() => summary && navigator.clipboard?.writeText(summary)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="复制"
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="-mx-1 max-h-[50vh] overflow-y-auto border-t border-border px-4 py-2.5">
        {loading ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Sparkles size={12} className="spk-twinkle" /> 港务助手生成中…
          </p>
        ) : err ? (
          <p className="text-[12px] text-destructive">{err}</p>
        ) : (
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{summary || '（项目上下文为空，暂无可总结内容）'}</pre>
        )}
      </div>
    </AnchoredPopover>
  )
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
