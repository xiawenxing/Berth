// src/server/transcript-turns.ts
// Best-effort parser that turns a CLI session jsonl into structured chat turns for the session drawer.
// Different CLIs (claude / codex / coco) write different jsonl shapes; we detect the ones we can and
// fall back to a single cleaned agent turn for anything unknown so this never throws on the caller.
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AgentCli } from '../types'
import { stripNoise, isInjectedText, extractContentText } from '../agent/transcript'
import type { Block, ChatTurn } from '../agent/normalize/chat-model'

export type TurnRole = 'user' | 'agent' | 'tool'
export interface Turn { role: TurnRole; text: string; collapsed?: boolean }

const HEAD_BYTES = 80_000  // keep the opening user prompt(s) from the START of the file
const TAIL_BYTES = 160_000 // keep the most recent turns from the END of the file
const MAX_BYTES = HEAD_BYTES + TAIL_BYTES // total cap ~240KB
const MAX_TURNS = 200
// Parse-time ceiling: large enough that both the head and tail reads are fully turned into turns
// (the ~240KB byte cap already bounds the work); the final MAX_TURNS trim happens in trimTurns().
const PARSE_TURN_CAP = 4_000
const MAX_TURN_CHARS = 8_000
const MAX_TOOL_CHARS = 4_000

/** A marker line the line-splitter tolerates (it parses each line as JSON; non-JSON lines are skipped). */
const HEAD_TAIL_MARKER = '\n__berth_head_tail_gap__\n'

/**
 * Read BOTH the head and the tail of a file so the opening user prompt(s) survive even in long
 * sessions while the recent turns still appear. We read up to HEAD_BYTES from the START + TAIL_BYTES
 * from the END, dropping the partial boundary line on the tail, and concatenate with a marker line
 * the JSONL splitter ignores. Small files are read whole.
 */
function readHeadAndTail(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    if (size <= MAX_BYTES) {
      const buf = Buffer.alloc(size)
      const n = readSync(fd, buf, 0, size, 0)
      return buf.toString('utf8', 0, n)
    }
    // Head: from the start. Keep whole lines (drop a trailing partial line so we don't feed a half JSON).
    const headBuf = Buffer.alloc(HEAD_BYTES)
    const hn = readSync(fd, headBuf, 0, HEAD_BYTES, 0)
    let head = headBuf.toString('utf8', 0, hn)
    const lastNl = head.lastIndexOf('\n')
    if (lastNl >= 0) head = head.slice(0, lastNl)

    // Tail: from the end. Drop the (likely partial) first line.
    const tailBuf = Buffer.alloc(TAIL_BYTES)
    const tn = readSync(fd, tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES)
    let tail = tailBuf.toString('utf8', 0, tn)
    const firstNl = tail.indexOf('\n')
    if (firstNl >= 0) tail = tail.slice(firstNl + 1)

    return head + HEAD_TAIL_MARKER + tail
  } finally { closeSync(fd) }
}

function clean(raw: string, max = MAX_TURN_CHARS): string {
  const stripped = stripNoise(raw).trim()
  return stripped.slice(0, max)
}

/** Push a turn. Per-role coalescing of adjacent 'tool' turns happens later in coalesceToolTurns(). */
function pushTurn(out: Turn[], role: TurnRole, text: string) {
  const t = text.trim()
  if (!t) return
  if (out.length >= PARSE_TURN_CAP) return
  out.push(role === 'tool' ? { role, text: t.slice(0, MAX_TOOL_CHARS), collapsed: true } : { role, text: t })
}

/**
 * Trim to MAX_TURNS while preserving the OPENING user prompt(s). When a long session yields more than
 * MAX_TURNS turns we keep the leading run of user turns (the opening prompt) plus the most recent
 * turns, so the chat shows both the original ask and the latest exchange rather than only the tail.
 */
function trimTurns(turns: Turn[]): Turn[] {
  if (turns.length <= MAX_TURNS) return turns
  // Leading run of user turns at the very top = the opening prompt(s).
  let headCount = 0
  while (headCount < turns.length && turns[headCount].role === 'user' && headCount < 4) headCount++
  if (headCount === 0) return turns.slice(-MAX_TURNS)
  const head = turns.slice(0, headCount)
  const tail = turns.slice(-(MAX_TURNS - headCount))
  return [...head, ...tail]
}

/**
 * Merge a run of adjacent role==='tool' turns into a single 'tool' turn so a sequence of tool_use +
 * tool_result rows renders as ONE "执行过程" collapsible instead of many noisy rows. Texts are joined
 * with a blank line, capped at MAX_TOOL_CHARS. user/agent turns are kept separate and in order.
 */
function coalesceToolTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = []
  for (const t of turns) {
    const prev = out[out.length - 1]
    if (t.role === 'tool' && prev && prev.role === 'tool') {
      const joined = `${prev.text}\n\n${t.text}`.slice(0, MAX_TOOL_CHARS)
      out[out.length - 1] = { ...prev, text: joined }
    } else {
      out.push(t)
    }
  }
  return out
}

function summarizeToolInput(input: any): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try { return JSON.stringify(input) } catch { return String(input) }
}

// ── claude: {type:'user'|'assistant', message:{role, content}} ──────────────────────────────────
// user content is either a string (real user text) or an array of tool_result blocks (tool turns).
// assistant content is an array of {type:'text'|'tool_use'|'thinking'} blocks.
function parseClaude(lines: string[]): Turn[] {
  const out: Turn[] = []
  for (const line of lines) {
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    const msg = o?.message
    if (o?.type === 'user' && msg?.role === 'user') {
      const content = msg.content
      if (typeof content === 'string') {
        const txt = clean(content)
        if (txt && !isInjectedText(txt)) pushTurn(out, 'user', txt)
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool_result') {
            const txt = clean(extractContentText(part.content), MAX_TOOL_CHARS)
            if (txt) pushTurn(out, 'tool', `工具结果\n${txt}`)
          } else if (part?.type === 'text' || typeof part === 'string') {
            const raw = typeof part === 'string' ? part : part.text ?? ''
            const txt = clean(raw)
            if (txt && !isInjectedText(txt)) pushTurn(out, 'user', txt)
          }
        }
      }
      continue
    }
    if (o?.type === 'assistant' && msg?.role === 'assistant') {
      const content = msg.content
      if (typeof content === 'string') {
        const txt = clean(content)
        if (txt) pushTurn(out, 'agent', txt)
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'text') {
            const txt = clean(part.text ?? '')
            if (txt) pushTurn(out, 'agent', txt)
          } else if (part?.type === 'tool_use') {
            const detail = summarizeToolInput(part.input)
            pushTurn(out, 'tool', `${part.name ?? 'tool'} ${detail}`.trim())
          }
          // thinking blocks are intentionally dropped
        }
      }
      continue
    }
  }
  return out
}

// ── codex: {type:'response_item', payload:{type:'message'|'function_call'|…}} ────────────────────
// Use response_item/message for user+assistant text; function_call → tool; skip event_msg/agent_message
// (it duplicates the assistant message text) and reasoning.
function parseCodex(lines: string[]): Turn[] {
  const out: Turn[] = []
  for (const line of lines) {
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (o?.type !== 'response_item') continue
    const p = o.payload
    if (!p) continue
    if (p.type === 'message') {
      const raw = extractContentText(p.content)
      const txt = clean(raw)
      if (!txt) continue
      if (p.role === 'user') {
        if (!isInjectedText(txt)) pushTurn(out, 'user', txt)
      } else if (p.role === 'assistant') {
        pushTurn(out, 'agent', txt)
      }
      // developer/system messages dropped
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const detail = summarizeToolInput(p.arguments ?? p.input)
      pushTurn(out, 'tool', `${p.name ?? 'function_call'} ${detail}`.trim())
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const raw = typeof p.output === 'string' ? p.output : extractContentText(p.output)
      const txt = clean(raw, MAX_TOOL_CHARS)
      if (txt) pushTurn(out, 'tool', `工具结果\n${txt}`)
    }
  }
  return out
}

// ── coco: {message:{message:{role, content, tool_calls?}}} or {tool_call} / {tool_call_output} ──
// The conversation lives in `events.jsonl` next to session.json (which is metadata only).
function parseCoco(lines: string[]): Turn[] {
  const out: Turn[] = []
  for (const line of lines) {
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    const inner = o?.message?.message
    if (inner && typeof inner === 'object') {
      const raw = typeof inner.content === 'string' ? inner.content : extractContentText(inner.content)
      const txt = clean(raw)
      if (inner.role === 'user') {
        if (txt && !isInjectedText(txt)) pushTurn(out, 'user', txt)
      } else if (inner.role === 'assistant') {
        if (txt) pushTurn(out, 'agent', txt)
      }
      if (Array.isArray(inner.tool_calls)) {
        for (const tc of inner.tool_calls) {
          const name = tc?.function?.name ?? tc?.name ?? 'tool'
          const args = tc?.function?.arguments ?? tc?.arguments
          pushTurn(out, 'tool', `${name} ${summarizeToolInput(args)}`.trim())
        }
      }
      continue
    }
    if (o?.tool_call) {
      const tc = o.tool_call
      const name = tc?.tool_info?.annotations?.title ?? tc?.tool_name ?? 'tool'
      const args = tc?.arguments ?? tc?.tool_args
      pushTurn(out, 'tool', `${name} ${summarizeToolInput(args)}`.trim())
      continue
    }
    if (o?.tool_call_output) {
      const raw = typeof o.tool_call_output === 'string'
        ? o.tool_call_output
        : (o.tool_call_output?.output ?? extractContentText(o.tool_call_output?.content))
      const txt = clean(typeof raw === 'string' ? raw : summarizeToolInput(raw), MAX_TOOL_CHARS)
      if (txt) pushTurn(out, 'tool', `工具结果\n${txt}`)
      continue
    }
  }
  return out
}

/** Fall back to a single cleaned agent turn so an unknown shape never crashes the drawer. */
function fallbackTurns(text: string): Turn[] {
  const cleaned = clean(text, MAX_TURN_CHARS)
  if (!cleaned) return []
  return [{ role: 'agent', text: cleaned }]
}

/**
 * Resolve the file that actually holds the conversation for this session. coco's content-source path is
 * `…/sessions/<id>/session.json` (metadata only); the turns are in `events.jsonl` next to it.
 */
export function resolveTranscriptPath(cli: AgentCli, contentSourcePath: string): string {
  if (cli === 'coco' && contentSourcePath.endsWith('session.json')) {
    const events = join(dirname(contentSourcePath), 'events.jsonl')
    if (existsSync(events)) return events
  }
  return contentSourcePath
}

/**
 * Parse a session jsonl (by CLI) into chat turns. Best-effort: returns a fallback single agent turn
 * for an unknown/unparseable shape. Caps total bytes/turns. Returns [] if the file is missing/empty.
 */
export function parseTranscriptTurns(cli: AgentCli, contentSourcePath: string | null | undefined): Turn[] {
  if (!contentSourcePath) return []
  const path = resolveTranscriptPath(cli, contentSourcePath)
  if (!existsSync(path)) return []
  let text: string
  try { text = readHeadAndTail(path) } catch { return [] }
  if (!text.trim()) return []
  const lines = text.split('\n').filter(l => l.trim())

  let turns: Turn[] = []
  try {
    if (cli === 'claude') turns = parseClaude(lines)
    else if (cli === 'codex') turns = parseCodex(lines)
    else if (cli === 'coco') turns = parseCoco(lines)
  } catch { turns = [] }

  // If a known-CLI parse yielded nothing usable, fall back to cleaned raw text.
  if (turns.length === 0) turns = fallbackTurns(text)
  // Coalesce adjacent tool turns into one "执行过程" row, then cap (preserving the opening prompt).
  return trimTurns(coalesceToolTurns(turns))
}

/**
 * Lossy bridge from the legacy/simple transcript shape to the rich Model-B chat shape. Used for
 * on-disk replay of CLIs that do not yet have a dedicated durable-jsonl reducer.
 */
export function transcriptTurnsToChatTurns(turns: Turn[]): ChatTurn[] {
  return turns.map((turn, index) => {
    const base = {
      id: `replay_${index}`,
      ts: 0,
    }
    if (turn.role === 'user') {
      return { ...base, role: 'user' as const, blocks: [{ kind: 'text', text: turn.text }] }
    }
    if (turn.role === 'tool') {
      const block: Block = {
        kind: 'tool_call',
        id: `replay_tool_${index}`,
        name: '执行过程',
        input: turn.text,
        status: 'done',
        result: { output: turn.text, ok: true },
      }
      return { ...base, role: 'assistant' as const, blocks: [block] }
    }
    return { ...base, role: 'assistant' as const, blocks: [{ kind: 'text', text: turn.text }] }
  })
}

export function parseTranscriptChatTurns(cli: AgentCli, contentSourcePath: string | null | undefined): ChatTurn[] {
  return transcriptTurnsToChatTurns(parseTranscriptTurns(cli, contentSourcePath))
}
