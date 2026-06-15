// src/agent/context-consolidate.ts
// Out-of-band consolidation (§7 Phase 2): ask the headless management agent to summarize a session's
// real progress into a structured {progress,status} patch. The agent ONLY produces text — Berth's
// applyConsolidation does the actual file edit. runAgentFn is injected for testability.
import { contextStrings, type Locale } from '../i18n'
import type { BerthAgent } from './index'

export interface ConsolidationResult { progress: string; status: string }

export interface ConsolidateInput {
  kind: 'task' | 'project'
  contextDoc: string
  transcript: string
  locale: Locale
  agent: BerthAgent
}

type RunAgentFn = (prompt: string, opts: { cli?: BerthAgent['cli']; model?: string; timeoutMs?: number }) => Promise<string>

/**
 * Slice the balanced `{...}` object starting at index `start`, respecting string literals so braces
 * inside values (and escaped quotes) don't throw off the depth count. Returns null if unbalanced.
 */
function sliceBalancedObject(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

/**
 * Defensively extract {progress,status} from a raw agent reply. Tolerates code fences AND surrounding
 * prose that itself contains braces: scan each `{`, take the balanced (string-aware) object, and use
 * the first one that parses and carries a progress/status key. A naive first-`{`/last-`}` slice would
 * break on replies like `here {is} the json: {…}` or `{…}. note: }`.
 */
export function parseConsolidation(raw: string): ConsolidationResult {
  const empty = { progress: '', status: '' }
  if (!raw) return empty
  const norm = (v: unknown, max: number) =>
    (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max)
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{') continue
    const candidate = sliceBalancedObject(raw, i)
    if (!candidate) break
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object' && ('progress' in obj || 'status' in obj))
        return { progress: norm(obj.progress, 200), status: norm(obj.status, 600) }
    } catch { /* not this object — keep scanning for the next `{` */ }
  }
  return empty
}

export async function consolidateContext(input: ConsolidateInput, runAgentFn: RunAgentFn): Promise<ConsolidationResult> {
  const c = contextStrings(input.locale)
  const prompt = c.consolidatePrompt(input.kind, input.contextDoc, input.transcript)
  try {
    const raw = await runAgentFn(prompt, { cli: input.agent.cli, model: input.agent.model || undefined, timeoutMs: 90000 })
    return parseConsolidation(raw)
  } catch {
    return { progress: '', status: '' }   // never throw into the trigger path
  }
}
