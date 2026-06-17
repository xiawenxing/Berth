import { useEffect, useState } from 'react'
import { Sparkles, Copy, Save } from 'lucide-react'
import { Dialog, Drawer } from './ui/Overlay'
import { api } from '@/lib/api'

/** 项目小结 — calls POST /projects/:id/summary (港务助手), shows sparkle while generating. */
export function ProjectSummaryDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [err, setErr] = useState('')

  const gen = () => {
    setLoading(true)
    setErr('')
    api
      .projectSummary(projectId)
      .then((r) => setSummary(r.summary || ''))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (open) gen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  return (
    <Dialog open={open} onClose={onClose} width={560}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles size={14} className={loading ? 'spk-twinkle' : 'text-brand'} />
        <h3 className="text-[13px] font-semibold text-foreground">项目小结</h3>
        <span className="flex-1" />
        <button onClick={gen} disabled={loading} className="text-[12px] text-muted-foreground hover:text-foreground">↻ 重新生成</button>
        <button
          onClick={() => summary && navigator.clipboard?.writeText(summary)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="复制"
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
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
    </Dialog>
  )
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
