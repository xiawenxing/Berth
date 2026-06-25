import { useRef } from 'react'
import { Square } from 'lucide-react'
import { PastedImageStrip, usePastedImages, type PastedImage } from './ImagePaste'
import { draftKey, usePersistentDraft } from '@/lib/draft-storage'

/**
 * Model B input: a chat composer that sends a user turn (Enter to send, Shift+Enter for newline). When
 * a turn is streaming it offers an interrupt instead of a disabled box, so the user can always act.
 */
export function Composer({
  onSend,
  onInterrupt,
  busy,
  draftScope = 'ephemeral',
}: {
  onSend: (text: string, images?: PastedImage[]) => void
  onInterrupt: () => void
  busy: boolean
  draftScope?: string
}) {
  const draft = usePersistentDraft(draftKey(`composer:${draftScope}`))
  const text = draft.value
  const setText = draft.setValue
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { images, clearImages, onPasteImages, removeImage } = usePastedImages()

  const submit = () => {
    const t = text.trim()
    if (busy || (!t && images.length === 0)) return
    onSend(t, images)
    draft.clear()
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
            type="button"
            onClick={onInterrupt}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="停止当前回合"
            title="中断当前回合"
          >
            <Square size={13} className="fill-current" />
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
