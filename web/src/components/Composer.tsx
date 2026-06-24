import { useRef, useState } from 'react'
import { PastedImageStrip, usePastedImages, type PastedImage } from './ImagePaste'

/**
 * Model B input: a chat composer that sends a user turn (Enter to send, Shift+Enter for newline). When
 * a turn is streaming it offers an interrupt instead of a disabled box, so the user can always act.
 */
export function Composer({
  onSend,
  onInterrupt,
  busy,
}: {
  onSend: (text: string, images?: PastedImage[]) => void
  onInterrupt: () => void
  busy: boolean
}) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()

  const submit = () => {
    const t = text.trim()
    if (busy || (!t && images.length === 0)) return
    onSend(t, images)
    setText('')
    clearImages()
    if (taRef.current) taRef.current.style.height = 'auto'
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }
  const canSend = !!text.trim() || images.length > 0

  return (
    <div className="border-t border-border bg-canvas px-3 py-2.5">
      <PastedImageStrip images={images} onRemove={removeImage} className="mb-2" />
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.target.value); grow(e.target) }}
          onPaste={onPasteImages}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="发消息… (Enter 发送 · Shift+Enter 换行，可粘贴图片)"
          className="max-h-[200px] min-h-[38px] flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
        />
        {busy ? (
          <button
            onClick={onInterrupt}
            className="h-[38px] shrink-0 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
            title="中断当前回合"
          >
            停止
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!canSend}
            className="h-[38px] shrink-0 rounded-md bg-brand px-4 text-sm text-brand-foreground disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
