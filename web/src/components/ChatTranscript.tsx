import { useEffect, useRef } from 'react'
import type { Block, ChatTurn } from '@/lib/chat'
import { Markdown } from './Markdown'

/**
 * Model B chat renderer: user turns as right-aligned bubbles, assistant turns left-aligned, tool calls
 * folded into one collapsed disclosure (call + result), reasoning as a collapsed chip, and a per-turn
 * "Worked for Ns" footer. Pure presentational — it just renders the ChatTurn[] the backend reduced.
 */
export function ChatTranscript({ turns }: { turns: ChatTurn[] }) {
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
      <div ref={endRef} />
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
      <div className="max-w-[88%] space-y-2">
        {turn.blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        {turn.streaming && <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" />}
      </div>
      {turn.result && <TurnFooter turn={turn} />}
    </div>
  )
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'text') {
    return (
      <div className="break-words rounded-2xl rounded-bl-sm bg-card px-4 py-2 text-sm text-foreground">
        <Markdown text={block.text} />
      </div>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <details className="rounded-md border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">💭 思考</summary>
        {!block.opaque && block.text && <Markdown text={block.text} className="mt-1" />}
      </details>
    )
  }
  return <ToolCallView block={block} />
}

function ToolCallView({ block }: { block: Extract<Block, { kind: 'tool_call' }> }) {
  const dot = block.status === 'error' ? 'bg-destructive' : block.status === 'running' ? 'bg-warning animate-pulse' : 'bg-success'
  return (
    <details className="rounded-md border border-border bg-card/60 text-xs">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-muted-foreground">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="font-medium text-foreground">{prettyToolName(block.name)}</span>
        <span className="truncate opacity-70">{summarizeInput(block.input)}</span>
      </summary>
      <div className="space-y-2 border-t border-border/60 px-3 py-2">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{stringify(block.input)}</pre>
        {block.result !== undefined && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border/40 pt-2 text-[11px] text-foreground">
            {clip(stringify(block.result.output), 4000)}
          </pre>
        )}
      </div>
    </details>
  )
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

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && 'text' in (x as any) ? (x as any).text : stringify(x))).join('\n')
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
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
