import type { Block, ChatTurn } from './chat-model'
import { stripNoise, isInjectedText } from '../transcript'

/**
 * Parse a claude on-disk session jsonl (the durable transcript at
 * ~/.claude/projects/<cwd>/<id>.jsonl) into ChatTurn[] for Model B history replay on resume.
 *
 * Different shape from the live wire stream: each line is a complete event with a top-level `type`
 * and the model turn under `.message` in Anthropic Messages format (content = string | block[]). Only
 * `user`/`assistant` lines are conversation; everything else is control/noise. tool_result rides a
 * `type:"user"` line and is folded into its tool_call block (paired by id). Injected/meta user lines
 * (hooks, skill bodies, <system-reminder>…) are dropped — same noise rules as titling.
 */
export function parseClaudeJsonlTurns(text: string): ChatTurn[] {
  const turns: ChatTurn[] = []
  const toolById = new Map<string, Block & { kind: 'tool_call' }>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (o?.type !== 'user' && o?.type !== 'assistant') continue   // skip system/snapshot/mode/… noise

    const ts = tsOf(o)
    const id = typeof o.uuid === 'string' ? o.uuid : `j${turns.length}`
    const content = o.message?.content

    if (o.type === 'assistant') {
      const blocks = blocksFromContent(content, toolById)
      if (blocks.length) turns.push({ id, role: 'assistant', ts, blocks })
      continue
    }

    // type === 'user'
    if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
      // tool_result line: fold into the matching tool_call block, do NOT create a user turn.
      for (const b of content) {
        if (b?.type !== 'tool_result') continue
        const tc = toolById.get(b.tool_use_id)
        if (!tc) continue
        const ok = !b.is_error
        tc.status = ok ? 'done' : 'error'
        tc.result = { output: b.content, ok }
      }
      continue
    }
    // Real human turn? Drop injected/meta (skill bodies, hook stdout, <system-reminder>…).
    if (o.isMeta || o.sourceToolUseID) continue
    const txt = humanText(content)
    if (txt) turns.push({ id, role: 'user', ts, blocks: [{ kind: 'text', text: txt }] })
  }
  return turns
}

function tsOf(o: any): number {
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0
}

function blocksFromContent(content: any, toolById: Map<string, Block & { kind: 'tool_call' }>): Block[] {
  if (typeof content === 'string') {
    const txt = stripNoise(content)
    return txt && !isInjectedText(txt) ? [{ kind: 'text', text: txt }] : []
  }
  if (!Array.isArray(content)) return []
  const blocks: Block[] = []
  for (const b of content) {
    if (b?.type === 'text') {
      const txt = stripNoise(b.text ?? '')
      if (txt && !isInjectedText(txt)) blocks.push({ kind: 'text', text: txt })
    } else if (b?.type === 'thinking') {
      if (b.thinking) blocks.push({ kind: 'reasoning', text: b.thinking, opaque: false })
    } else if (b?.type === 'tool_use') {
      const tc: Block & { kind: 'tool_call' } = { kind: 'tool_call', id: b.id, name: b.name, input: b.input ?? {}, status: 'running' }
      toolById.set(b.id, tc)
      blocks.push(tc)
    }
  }
  return blocks
}

function humanText(content: any): string {
  if (typeof content === 'string') {
    const txt = stripNoise(content)
    return txt && !isInjectedText(txt) ? txt : ''
  }
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b?.type !== 'text') continue
    const txt = stripNoise(b.text ?? '')
    if (txt && !isInjectedText(txt)) parts.push(txt)
  }
  return parts.join('\n')
}
