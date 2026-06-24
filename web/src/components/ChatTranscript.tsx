import { useEffect, useRef } from 'react'
import type { Block, ChatTurn } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

/**
 * Model B chat renderer: user turns as right-aligned bubbles, assistant turns left-aligned. Assistant
 * text and tool calls stay in one chronological flow; tool calls are muted text, final answers are
 * rendered with normal text weight/color. Pure presentational — it just renders ChatTurn[].
 */
export function ChatTranscript({ turns, thinking = false }: { turns: ChatTurn[]; thinking?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  // Autoscroll to the newest content only when the user is already pinned to the bottom (so reading
  // scrollback isn't yanked away by a streaming turn).
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  })

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      {turns.length === 0 && (
        <div className="m-auto text-sm text-muted-foreground">还没有对话。在下方输入开始。</div>
      )}
      {turns.map((t) => (t.role === 'user' ? <UserBubble key={t.id} turn={t} /> : <AssistantTurn key={t.id} turn={t} />))}
      {thinking && <ThinkingBubble />}
      <div ref={endRef} />
    </div>
  )
}

/** Shown between submitting a turn and the agent's first frame — the "thinking" gap that otherwise
 *  looked idle and made users think the session never started. */
function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
      </span>
      正在思考…
    </div>
  )
}

function UserBubble({ turn }: { turn: ChatTurn }) {
  const text = turn.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-brand-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantTurn({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="w-full max-w-[88%] space-y-2 text-sm leading-relaxed text-foreground">
        {turn.blocks.map((b, i) => (
          <FlowBlock key={i} block={b} />
        ))}
        {turn.streaming && <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" />}
      </div>
      {turn.result && <TurnFooter turn={turn} />}
    </div>
  )
}

function FlowBlock({ block }: { block: Block }) {
  if (block.kind === 'text') {
    if (!block.text.trim()) return null
    return <Markdown text={block.text} className="break-words text-foreground" />
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="break-words text-sm text-muted-foreground">
        {block.opaque || !block.text ? '思考中…' : <Markdown text={block.text} />}
      </div>
    )
  }
  return <ToolCallLine block={block} />
}

function ToolCallLine({ block }: { block: Extract<Block, { kind: 'tool_call' }> }) {
  const error = block.status === 'error'
  return (
    <div className={cn('flex min-w-0 items-baseline gap-2 text-sm leading-relaxed text-muted-foreground', error && 'text-destructive')}>
      <span className="select-none opacity-70">›</span>
      <span className="min-w-0 truncate">{toolCallSummary(block)}</span>
    </div>
  )
}

export function toolCallSummary(block: Extract<Block, { kind: 'tool_call' }>): string {
  const label = prettyToolName(block.name)
  const input = summarizeInput(block.input)
  const status = block.status === 'running' ? '运行中' : block.status === 'error' ? '失败' : ''
  return [label, input, status].filter(Boolean).join(' · ')
}

function TurnFooter({ turn }: { turn: ChatTurn }) {
  const r = turn.result!
  const secs = r.durationMs ? (r.durationMs / 1000).toFixed(r.durationMs < 10000 ? 1 : 0) : null
  return (
    <div className="pl-1 text-[11px] text-muted-foreground">
      {r.isError ? <span className="text-destructive">已中断{r.errorSubtype ? ` (${r.errorSubtype})` : ''}</span> : secs && <span>Worked for {secs}s</span>}
      {r.usage?.output != null && <span className="opacity-70"> · {r.usage.output} tok</span>}
    </div>
  )
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const first = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.query
    if (typeof first === 'string') return clip(first, 80)
  }
  if (typeof input === 'string') return clip(input, 80)
  return ''
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// codex emits snake_case item types as the tool name (command_execution, web_search, …); map the
// known ones to friendly labels. claude tool names (Bash, Read, Edit, …) are already clean → pass through.
const TOOL_LABELS: Record<string, string> = {
  command_execution: '命令执行',
  file_change: '文件改动',
  mcp_tool_call: 'MCP 工具',
  web_search: '网页搜索',
  plan_update: '计划更新',
}
export function prettyToolName(name: string): string {
  return TOOL_LABELS[name] ?? name
}
