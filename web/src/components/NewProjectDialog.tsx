import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Dialog } from './ui/Overlay'
import { PastedImageStrip, pastedImageDataUrls, usePastedImages } from './ImagePaste'

/**
 * 新建项目 — name + description + ☑ AI 根据描述生成项目上下文. No repo path
 * (the cwd is chosen in the 货舱 at launch). Immediate-create; AI generates the
 * project context doc in the background.
 */
export function NewProjectDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, desc: string, aiContext: boolean, images: string[]) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [ai, setAi] = useState(true)
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDesc('')
      setAi(true)
      clearImages()
      setTimeout(() => ref.current?.focus(), 0)
    }
  }, [open, clearImages])

  const create = () => {
    if (!name.trim()) return
    onCreate(name.trim(), desc.trim(), ai, pastedImageDataUrls(images))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} width={480}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">新建项目</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">登记一个项目港湾</p>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div>
          <label className="mb-1 block text-[10.5px] text-muted-foreground">项目名称</label>
          <input
            ref={ref}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 berth-mobile"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10.5px] text-muted-foreground">描述</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onPaste={onPasteImages}
            rows={3}
            placeholder="简单描述这个项目是做什么的…（可粘贴图片）"
            className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
          />
          <PastedImageStrip images={images} onRemove={removeImage} className="mt-2" />
        </div>
        <button onClick={() => setAi((v) => !v)} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${ai ? 'border-brand bg-brand' : 'border-border'}`}>
            {ai && <span className="text-[9px] text-brand-foreground">✓</span>}
          </span>
          <Sparkles size={12} className={ai ? 'text-brand' : ''} /> AI 根据描述生成项目上下文
        </button>
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
