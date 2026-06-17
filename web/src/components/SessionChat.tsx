import { useEffect, useState } from 'react'
import { ChevronRight, Copy, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type TranscriptTurn } from '@/lib/api'

/**
 * Codex-style conversation rendered from a real session transcript:
 *  - user → right-aligned bubble
 *  - agent → left-aligned plain rich text (fenced ```code``` as a mono block w/ copy, inline `code` as a chip)
 *  - tool → collapsible one-line "执行过程 ▸" summary, collapsed by default
 * Fetches GET /api/sessions/:id/transcript on mount; can subscribe to session events while a hidden
 * PTY turn is running so the chat view updates as the transcript file changes.
 */
export function SessionChat({
  sessionId,
  refreshKey = 0,
  stream = false,
  optimisticUserText,
}: {
  sessionId: string
  refreshKey?: number
  stream?: boolean
  optimisticUserText?: string | null
}) {
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const firstLoad = turns === null
    if (firstLoad) setErr(null)
    api
      .transcript(sessionId)
      .then((r) => alive && setTurns(r.turns ?? []))
      .catch((e) => alive && firstLoad && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshKey])

  useEffect(() => {
    if (!stream) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/session-events?sessionId=${encodeURIComponent(sessionId)}`)
    ws.onmessage = (e) => {
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === 'turns' && Array.isArray(msg.turns)) {
        setTurns(msg.turns)
        setErr(null)
      }
    }
    return () => ws.close()
  }, [sessionId, stream])

  if (err) {
    return (
      <div className="px-5 py-6 text-[13px] text-destructive">无法加载会话记录：{err}</div>
    )
  }
  if (turns === null) {
    return (
      <div className="flex items-center gap-1.5 px-5 py-6 text-[12px] text-muted-foreground">
        <Sparkles size={13} className="spk-twinkle" /> 正在解析会话记录…
      </div>
    )
  }
  const shownTurns = appendOptimisticUser(turns, optimisticUserText)

  if (shownTurns.length === 0) {
    return <div className="px-5 py-6 text-[13px] text-muted-foreground">该会话暂无可显示的对话内容。</div>
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4 text-[13px]">
      {shownTurns.map((t, i) => {
        if (t.role === 'user') return <UserMsg key={i}>{t.text}</UserMsg>
        if (t.role === 'tool') return <ToolMsg key={i} text={t.text} />
        return (
          <AgentMsg key={i}>
            <RichText text={t.text} />
          </AgentMsg>
        )
      })}
    </div>
  )
}

function appendOptimisticUser(turns: TranscriptTurn[], text?: string | null): TranscriptTurn[] {
  const t = text?.trim()
  if (!t) return turns
  if (turns.some((x) => x.role === 'user' && x.text.trim() === t)) return turns
  return [...turns, { role: 'user', text: t }]
}

function UserMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[72%] whitespace-pre-wrap rounded-md bg-secondary px-3 py-2 text-foreground">{children}</div>
    </div>
  )
}

function AgentMsg({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[88%] leading-relaxed text-foreground">{children}</div>
}

function ToolMsg({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-[88%]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
        执行过程
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11.5px] leading-relaxed text-text-dim">
          {text}
        </pre>
      )}
    </div>
  )
}

/**
 * Minimal rich-text renderer: splits on fenced ```code``` blocks, renders each block as a mono code
 * card with a copy button; the prose segments render inline `code` as chips. No markdown dependency.
 */
function RichText({ text }: { text: string }) {
  const segments = splitFences(text)
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} code={seg.text} />
        ) : (
          <Prose key={i} text={seg.text} />
        ),
      )}
    </>
  )
}

type Segment = { type: 'text' | 'code'; text: string }

/** Split text into prose + fenced-code segments. Tolerates an unterminated final fence. */
function splitFences(text: string): Segment[] {
  const out: Segment[] = []
  const re = /```[^\n]*\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'code', text: m[1].replace(/\n$/, '') })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out.filter((s) => s.text.trim().length > 0)
}

function Prose({ text }: { text: string }) {
  // Render inline `code` as chips, keep paragraph whitespace.
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[12px]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="relative my-2 rounded-md border border-border bg-background/60 p-3 font-mono text-[12px]">
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded p-1 text-text-dim hover:bg-muted hover:text-foreground"
        title={copied ? '已复制' : '复制'}
      >
        <Copy size={12} />
      </button>
      <pre className="overflow-x-auto whitespace-pre text-foreground">{code}</pre>
    </div>
  )
}
