import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { turnHasVisibleContent, type Block, type ChatTurn } from '@/lib/chat'
import { splitImagePathPlaceholders } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

/**
 * Model B chat renderer: user turns as right-aligned bubbles, assistant turns left-aligned. Assistant
 * text and tool calls stay in one chronological flow; tool calls are muted text, final answers are
 * rendered with normal text weight/color. Pure presentational — it just renders ChatTurn[].
 */
export function ChatTranscript({
  turns,
  thinking = false,
  loading = false,
  error,
}: {
  turns: ChatTurn[]
  thinking?: boolean
  loading?: boolean
  error?: string
}) {
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
    // Depend on the content that can change the scroll height (turns upsert a fresh array ref per
    // streaming frame; thinking toggles the indicator). Without a dep array this fired a layout-
    // forcing scrollIntoView on *every* render.
  }, [turns, thinking])

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      {turns.length === 0 && loading && (
        <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-brand" />
          正在加载会话历史…
        </div>
      )}
      {turns.length === 0 && !loading && error && (
        <div className="m-auto text-sm text-destructive">{error}</div>
      )}
      {turns.length === 0 && !loading && !error && (
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
  const images = turn.blocks.filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image')
  const text = turn.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')
  const hasImages = images.length > 0
  const textParts = splitImagePathPlaceholders(text)
  return (
    <div className="berth-chat-turn flex justify-end">
      <div className="flex max-w-[78%] flex-col items-end gap-2">
        {hasImages && (
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            {images.map((image, idx) => (
              <img
                key={`${image.src}-${idx}`}
                src={image.src}
                alt={image.alt ?? ''}
                className="max-h-28 max-w-[180px] rounded-xl border border-border bg-card object-contain shadow-sm"
              />
            ))}
          </div>
        )}
        {text.trim() && (
          <div
            className={cn(
              'whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-4 py-2 text-sm',
              hasImages ? 'bg-card/70 text-foreground' : 'bg-brand text-brand-foreground',
            )}
          >
            {textParts.map((part, idx) => (
              part.kind === 'image'
                ? <span key={`${part.path}-${idx}`} title={part.path} className="font-medium underline decoration-dotted underline-offset-2">{part.text}</span>
                : <span key={idx}>{part.text}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({ turn }: { turn: ChatTurn }) {
  const visible = turnHasVisibleContent(turn)
  if (!visible && turn.streaming) return null
  const { process, answer } = splitProcessAndAnswer(turn.blocks)
  const hasProcess = process.length > 0

  return (
    <div className="berth-chat-turn flex flex-col items-start gap-1.5">
      <div className="w-full max-w-[88%] space-y-2 text-sm leading-relaxed text-foreground">
        {visible ? (
          <>
            {hasProcess && <ProcessFold turn={turn} blocks={process} />}
            {answer.map((b, i) => (
              <FlowBlock key={i} block={b} />
            ))}
            {turn.streaming && <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" />}
          </>
        ) : (
          <span className="text-muted-foreground">没有可显示的回复。</span>
        )}
      </div>
      {!hasProcess && turn.result && <TurnFooter turn={turn} />}
    </div>
  )
}

export function splitProcessAndAnswer(blocks: Block[]): { process: Block[]; answer: Block[] } {
  let i = blocks.length
  while (i > 0 && blocks[i - 1].kind === 'text') i--
  return { process: blocks.slice(0, i), answer: blocks.slice(i) }
}

function ProcessFold({ turn, blocks }: { turn: ChatTurn; blocks: Block[] }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? !!turn.streaming
  const label = processLabel(turn, blocks)
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        className="flex max-w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground"
      >
        <ChevronRight size={14} className={cn('flex-none transition-transform', open && 'rotate-90')} />
        <span className="truncate">{label}</span>
        {turn.result?.usage?.output != null && <span className="shrink-0 opacity-70">· {turn.result.usage.output} tok</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l border-border/60 pl-4">
          {blocks.map((b, i) => (
            <FlowBlock key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  )
}

function processLabel(turn: ChatTurn, blocks: Block[]): string {
  const steps = blocks.filter((b) => b.kind === 'tool_call').length
  const r = turn.result
  if (r?.isError) return `已中断${r.errorSubtype ? ` (${r.errorSubtype})` : ''}`
  if (turn.streaming) return steps ? `工作中… · ${steps} 步` : '工作中…'
  const duration = r?.durationMs ? `Worked for ${formatDuration(r.durationMs)}` : '过程'
  return steps ? `${duration} · ${steps} 步` : duration
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
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
  if (block.kind === 'image') {
    return <img src={block.src} alt={block.alt ?? ''} className="max-h-72 max-w-full rounded-md border border-border object-contain" />
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
