import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Block, ChatTurn } from '@/lib/chat'
import { fileEditsFromTurn, type FileEdit } from '@/lib/fileEdits'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

/**
 * Model B chat renderer: user turns as right-aligned bubbles, assistant turns left-aligned, tool calls
 * folded into one collapsed disclosure (call + result), reasoning as a collapsed chip, and a per-turn
 * "Worked for Ns" footer. Pure presentational — it just renders the ChatTurn[] the backend reduced.
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
  const { work, answer } = splitBlocks(turn.blocks)
  const edits = useMemo(() => fileEditsFromTurn(turn), [turn])
  const hasFold = work.length > 0
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="w-full max-w-[88%] space-y-2">
        {hasFold && <WorkFold turn={turn} work={work} />}
        {answer.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        {edits.length > 0 && <EditedFilesCard edits={edits} />}
        {turn.streaming && <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" />}
      </div>
      {!hasFold && turn.result && <TurnFooter turn={turn} />}
    </div>
  )
}

/** Split a turn into work (everything up to the trailing text run) and answer (the trailing text run). */
function splitBlocks(blocks: Block[]): { work: Block[]; answer: Block[] } {
  let i = blocks.length
  while (i > 0 && blocks[i - 1].kind === 'text') i--
  return { work: blocks.slice(0, i), answer: blocks.slice(i) }
}

function WorkFold({ turn, work }: { turn: ChatTurn; work: Block[] }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? !!turn.streaming
  const steps = work.filter((b) => b.kind === 'tool_call').length
  const r = turn.result
  const secs = r?.durationMs ? (r.durationMs / 1000).toFixed(r.durationMs < 10000 ? 1 : 0) : null
  let label: string
  if (r?.isError) label = `已中断${r.errorSubtype ? ` (${r.errorSubtype})` : ''}`
  else if (turn.streaming) label = `工作中… · ${steps} 步`
  else label = `${secs ? `Worked for ${secs}s` : '已完成'} · ${steps} 步`
  return (
    <div className="rounded-md border border-border/60 bg-card/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground"
      >
        <ChevronRight size={14} className={cn('flex-none transition-transform', open && 'rotate-90')} />
        <span className={r?.isError ? 'text-destructive' : undefined}>{label}</span>
        {r?.usage?.output != null && <span className="opacity-70">· {r.usage.output} tok</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2 pl-4">
          {work.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  )
}

function EditedFilesCard({ edits }: { edits: FileEdit[] }) {
  const totalAdded = edits.reduce((s, e) => s + e.added, 0)
  const totalRemoved = edits.reduce((s, e) => s + e.removed, 0)
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/60 text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium text-foreground">Edited {edits.length} file{edits.length > 1 ? 's' : ''}</span>
        <span className="tabular-nums">
          <span className="text-success">+{totalAdded}</span> <span className="text-destructive">-{totalRemoved}</span>
        </span>
      </div>
      <ul>
        {edits.map((e) => (
          <EditedFileRow key={e.path} edit={e} />
        ))}
      </ul>
    </div>
  )
}

function EditedFileRow({ edit }: { edit: FileEdit }) {
  const [open, setOpen] = useState(false)
  const expandable = edit.hunks.length > 0
  const slash = edit.path.lastIndexOf('/')
  const dir = slash >= 0 ? edit.path.slice(0, slash + 1) : ''
  const base = slash >= 0 ? edit.path.slice(slash + 1) : edit.path
  return (
    <li className="border-t border-border/40 first:border-t-0">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default"
      >
        {expandable ? (
          <ChevronRight size={12} className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-3 flex-none" />
        )}
        <span className="truncate">
          <span className="opacity-60">{dir}</span>
          <span className="text-foreground">{base}</span>
        </span>
        <span className="ml-auto flex-none tabular-nums">
          <span className="text-success">+{edit.added}</span> <span className="text-destructive">-{edit.removed}</span>
        </span>
      </button>
      {open && expandable && (
        <div className="border-t border-border/40">
          <pre className="max-h-72 overflow-auto text-[11px] leading-relaxed">
            {edit.hunks.map((h, i) => (
              <div
                key={i}
                className={cn(
                  'px-3',
                  h.op === '+' && 'bg-success/10 text-success',
                  h.op === '-' && 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="select-none opacity-60">{h.op}</span> {h.text}
              </div>
            ))}
          </pre>
          {edit.truncated && <div className="px-3 py-1 text-[11px] text-muted-foreground">diff 已截断</div>}
        </div>
      )}
    </li>
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
