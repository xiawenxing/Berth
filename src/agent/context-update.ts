// src/agent/context-update.ts
// Unified context updater (replaces context-consolidate.ts). Feed the agent the FULL current context
// doc plus user-supplied info and/or a session transcript; it returns the FULL updated markdown —
// ANY section may change. Berth computes the section diff (doc-diff) and writes/commits. The agent's
// write power is unconstrained on purpose; git history (doc-git) is the safety net.
import { contextStrings, type Locale } from '../i18n'
import { diffSections, type SectionDiff } from '../data/doc-diff'
import type { BerthAgent } from './index'

export interface ContextUpdateInput {
  kind: 'task' | 'project'
  contextDoc: string
  userInput?: string
  transcript?: string
  date: string            // 'YYYY-MM-DD' — injected by the caller; the agent must not invent dates
  locale: Locale
  agent: BerthAgent
}
export interface ContextUpdateResult { newDoc: string; diff: SectionDiff }

type RunAgentFn = (prompt: string, opts: { cli?: BerthAgent['cli']; model?: string; timeoutMs?: number }) => Promise<string>

const EMPTY: SectionDiff = { changed: [], added: [], removed: [] }

/** Unwrap a single wrapping ```...``` / ```markdown fence if the whole reply is fenced. */
export function stripCodeFence(s: string): string {
  const t = (s ?? '').trim()
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(t)
  return (m ? m[1] : t).trim()
}

/** Keep the markdown document even if the agent prepends a short explanation before the first H1. */
export function extractMarkdownDoc(s: string): string {
  const t = stripCodeFence(s)
  if (/^#\s+/m.test(t) && !t.startsWith('#')) return t.slice(t.search(/^#\s+/m)).trim()
  return t
}

export async function updateContext(input: ContextUpdateInput, runAgentFn: RunAgentFn): Promise<ContextUpdateResult> {
  const c = contextStrings(input.locale)
  const prompt = c.updatePrompt(input.kind, input.contextDoc, {
    userInput: input.userInput ?? '', transcript: input.transcript ?? '', date: input.date,
  })
  try {
    const raw = await runAgentFn(prompt, { cli: input.agent.cli, model: input.agent.model || undefined, timeoutMs: 120000 })
    const newDoc = extractMarkdownDoc(raw)
    // Guard: empty, or shorter than 40% of the source (a truncated/gutted reply) → refuse to write.
    if (!newDoc || newDoc.length < Math.max(40, input.contextDoc.length * 0.4)) return { newDoc: '', diff: EMPTY }
    const diff = diffSections(input.contextDoc, newDoc)
    if (!diff.changed.length && !diff.added.length && !diff.removed.length) return { newDoc: '', diff: EMPTY }
    return { newDoc, diff }
  } catch { return { newDoc: '', diff: EMPTY } }
}
