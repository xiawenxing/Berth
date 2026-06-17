// src/server/transcript-turns.ts
// Best-effort parser that turns a CLI session jsonl into structured chat turns for the session drawer.
// Different CLIs (claude / codex / coco) write different jsonl shapes; we detect the ones we can and
// fall back to a single cleaned agent turn for anything unknown so this never throws on the caller.
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AgentCli } from '../types'
import { stripNoise, isInjectedText, extractContentText } from '../agent/transcript'

export type TurnRole = 'user' | 'agent' | 'tool'
export interface Turn { role: TurnRole; text: string; collapsed?: boolean }

const MAX_BYTES = 200_000
const MAX_TURNS = 200
const MAX_TURN_CHARS = 8_000
const MAX_TOOL_CHARS = 4_000

/** Read the LAST `maxBytes` of a file (the tail is the most recent conversation). */
function readTail(path: string, maxBytes = MAX_BYTES): string {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const start = size > maxBytes ? size - maxBytes : 0
    const len = Math.min(size, maxBytes)
    const buf = Buffer.alloc(len)
    const n = readSync(fd, buf, 0, len, start)
    let text = buf.toString('utf8', 0, n)
    // If we sliced mid-file, drop the (likely partial) first line.
    if (start > 0) {
      const nl = text.indexOf('\n')
      if (nl >= 0) text = text.slice(nl + 1)
    }
    return text
  } finally { closeSync(fd) }
}

function clean(raw: string, max = MAX_TURN_CHARS): string {
  const stripped = stripNoise(raw).trim()
  return stripped.slice(0, max)
}

/** Push a turn, coalescing consecutive same-role turns is intentionally NOT done — keep chronology. */
function pushTurn(out: Turn[], role: TurnRole, text: string) {
  const t = text.trim()
  if (!t) return
  if (out.length >= MAX_TURNS) return
  out.push(role === 'tool' ? { role, text: t.slice(0, MAX_TOOL_CHARS), collapsed: true } : { role, text: t })
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
  try { text = readTail(path) } catch { return [] }
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
  return turns.slice(-MAX_TURNS)
}
