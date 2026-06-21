import { useEffect, useRef, useState } from 'react'
import { Sparkles, Play } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, pastedImageDataUrls, usePastedImages, type PastedImage } from './ImagePaste'
import type { Task } from '@/lib/types'

/**
 * 新建任务 — minimal immediate-create model: one big title textarea + two small
 * checkboxes (AI 自动总结标题 / 立即执行). 创建 makes a card NOW; if AI-summarize,
 * the card refines its title + fills 进展摘要 in the background (caller does that).
 */
export function NewTaskDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (raw: string, opts: { aiSummarize: boolean; runNow: boolean; images: string[] }) => void
}) {
  const [text, setText] = useState('')
  const [ai, setAi] = useState(true)
  const [run, setRun] = useState(false)
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setText('')
      setAi(true)
      setRun(false)
      clearImages()
      setTimeout(() => ref.current?.focus(), 0)
    }
  }, [open, clearImages])

  const create = () => {
    if (!text.trim() && images.length === 0) return
    onCreate(text.trim(), { aiSummarize: ai, runNow: run, images: pastedImageDataUrls(images) })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} width={460}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">新建任务</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">写个标题就走 · 港务助手在后台补全</p>
      </div>

      <div className="p-4">
        <label className="mb-1 block text-[10.5px] text-muted-foreground">任务标题</label>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
          取消
        </button>
        <button onClick={create} className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground">
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

export type NewTaskResult = { raw: string; opts: { aiSummarize: boolean; runNow: boolean; images: string[] } }
export type { Task }
export type { PastedImage }
