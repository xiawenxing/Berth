import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'

/**
 * Bottom composer for a session's chat transcript: a textarea + 发送 button. Submitting calls
 * onSend(text) — the parent resumes the live session (a <Terminal> with initialInput) so the user
 * continues the conversation live. Enter sends, Shift+Enter inserts a newline. Token color classes
 * keep it readable in both light and dark themes.
 */
export function SessionComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <div className="border-t border-border bg-canvas px-4 py-3">
      <div className="flex items-end gap-2 rounded-md border border-border bg-card p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder="输入消息，继续这个会话…"
          className="min-h-0 flex-1 resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-dim"
        />
        <button
          onClick={send}
          disabled={!text.trim()}
          className="flex flex-none items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground disabled:opacity-50"
          title="继续这个会话"
        >
          发送 <SendHorizontal size={12} />
        </button>
      </div>
    </div>
  )
}
