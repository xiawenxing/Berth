/**
 * transcript.ts - shared helpers for stripping hook/system/command-injected noise
 * from claude/codex/coco session transcript heads before title/context extraction.
 */

/** Markers that indicate hook-injected or system content, not real user messages. */
const HOOK_MARKERS = [
  'Conduit', 'B-role', 'conduit-hooks', 'SessionStart hook',
  'additionalContext', 'environment_context', 'user_instructions',
  '<EXTREMELY_IMPORTANT>', 'superpowers', 'using-superpowers',
  'AGENTS.md', 'BERTH_SENTINEL', 'treat as reference', 'Context for this task',
]

const IMAGE_PATH_RE = /(?:(?:~|\/)[^\n\r]*?\.(?:png|jpe?g|gif|webp|bmp|heic|heif|tiff?))/gi

export function replaceImagePathReferences(text: string, placeholder = '[图片]'): string {
  return text.replace(IMAGE_PATH_RE, placeholder)
}

/** Strip tag blocks and block-level injected content from text. */
export function stripNoise(text: string): string {
  // Remove <system-reminder>...</system-reminder> blocks
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  // Remove <persisted-output>...</persisted-output> blocks
  text = text.replace(/<persisted-output>[\s\S]*?<\/persisted-output>/g, '')
  // Remove slash-command wrappers
  text = text.replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
  text = text.replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
  text = text.replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
  text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
  return text.trim()
}

/** Return true if the text (after stripping) should be considered injected/system noise. */
export function isInjectedText(text: string): boolean {
  if (!text) return true
  if (text.startsWith('<')) return true
  for (const marker of HOOK_MARKERS) {
    if (text.includes(marker)) return true
  }
  return false
}

/**
 * Extract text from a potentially truncated user-message JSON line via regex.
 * Scans for "text":"..." values, skipping base64/data-URI image values.
 * Returns the first non-empty, non-injected text value found.
 */
function extractTextViaRegex(line: string): string | null {
  const TEXT_RE = /"text":"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = TEXT_RE.exec(line)) !== null) {
    const raw = m[1]
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\t/g, ' ')
      .replace(/\\\\/g, '\\')
      .trim()
    if (!raw) continue
    // Skip base64 image data
    if (raw.startsWith('data:image')) continue
    const cleaned = replaceImagePathReferences(stripNoise(raw)).replace(/\s+/g, ' ').trim()
    if (cleaned && !isInjectedText(cleaned)) return cleaned.slice(0, 700)
  }
  return null
}

/**
 * Extract the first ~3 genuine user messages from a raw transcript head (JSONL text).
 * Works for claude and codex jsonl formats.
 *
 * Handles truncated lines (e.g. lines containing large base64 images) by falling
 * back to regex extraction when JSON.parse fails.
 *
 * Returns cleaned text (first ~3 messages joined by " / "), max ~2000 chars.
 * Falls back to a regex-extracted summary of the raw head if nothing survives via JSON.
 */
export function extractUserGist(head: string): string {
  const surviving: string[] = []

  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    if (surviving.length >= 3) break

    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      // Truncated line — try regex extraction if it looks like a user message
      if (line.includes('"type":"user"') || line.includes('"type": "user"')) {
        // Make sure it's a claude user message (not an attachment or other type with user in it)
        if (line.includes('"role":"user"') || line.includes('"role": "user"')) {
          const text = extractTextViaRegex(line)
          if (text) surviving.push(text)
        }
      }
      continue
    }

    // Claude format: type === 'user'
    if (o.type === 'user' && o.message?.role === 'user') {
      const raw = extractContentText(o.message.content)
      const cleaned = replaceImagePathReferences(stripNoise(raw)).replace(/\s+/g, ' ').trim()
      if (cleaned && !isInjectedText(cleaned)) {
        surviving.push(cleaned.slice(0, 700))
      }
      continue
    }

    // Codex format: type === 'response_item' with payload.role === 'user'
    if (o.type === 'response_item' && o.payload?.type === 'message' && o.payload?.role === 'user') {
      const content = o.payload.content
      const raw = Array.isArray(content)
        ? content.map((c: any) => c?.text ?? '').join(' ')
        : typeof content === 'string' ? content : ''
      const cleaned = replaceImagePathReferences(stripNoise(raw)).replace(/\s+/g, ' ').trim()
      if (cleaned && !isInjectedText(cleaned)) {
        surviving.push(cleaned.slice(0, 700))
      }
      continue
    }
  }

  if (surviving.length > 0) {
    return surviving.join(' / ').slice(0, 2000)
  }

  // Fallback: strip known noisy tag blocks from the raw head.
  // This removes <system-reminder> blocks etc. but raw JSON attachment content
  // (Conduit additionalContext) is not XML-tagged so we can't strip it here.
  // Return empty string so callers can decide whether to pass the raw head.
  return ''
}

/**
 * Extract a clean conversation digest from a raw transcript (JSONL): user queries and assistant
 * TEXTUAL replies only, in order, up to ~maxChars. Tool calls, tool results/artifacts, and
 * thinking/reasoning are dropped (none carry a top-level `.text`, so `extractContentText` already
 * skips them); injected hook/system noise is stripped. Used to feed the task summary a faithful
 * record of what was asked and answered, without the process noise.
 */
export function extractConversation(text: string, maxChars = 6000): string {
  const out: string[] = []
  let used = 0
  const push = (role: 'USER' | 'ASSISTANT', raw: string) => {
    const cleaned = cleanText(raw, 1000)
    if (!cleaned) return
    const line = `${role}: ${cleaned}`
    out.push(line)
    used += line.length + 1
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (used >= maxChars) break

    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      // Truncated line (large embedded artifact) — salvage a user message via regex only.
      if ((line.includes('"type":"user"') || line.includes('"type": "user"')) &&
          (line.includes('"role":"user"') || line.includes('"role": "user"'))) {
        const t = extractTextViaRegex(line)
        if (t) push('USER', t)
      }
      continue
    }

    // Claude format
    if (o.type === 'user' && o.message?.role === 'user') {
      push('USER', extractContentText(o.message.content))
      continue
    }
    if (o.type === 'assistant' && o.message?.role === 'assistant') {
      push('ASSISTANT', extractContentText(o.message.content))
      continue
    }

    // Codex format (response_item message; function_call / reasoning are ignored)
    if (o.type === 'response_item' && o.payload?.type === 'message') {
      const p = o.payload
      const body = extractContentText(p.content)
      if (p.role === 'user') {
        // Skip the codex environment/instructions preamble (markdown headed with '#').
        if (body && !body.trim().startsWith('#')) push('USER', body)
      } else if (p.role === 'assistant') {
        push('ASSISTANT', body)
      }
    }
  }
  return out.join('\n').slice(0, maxChars)
}

/** Flatten message content (string or array) into plain text. */
export function extractContentText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join(' ')
  }
  return ''
}

export interface TitleContextSample {
  users: string[]
  assistants: string[]
  tools: string[]
}

function cleanText(raw: string, max = 700): string {
  const cleaned = replaceImagePathReferences(stripNoise(raw))
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || isInjectedText(cleaned)) return ''
  return cleaned.slice(0, max)
}

function cleanUserTitleText(raw: string, max = 700): string {
  return cleanText(raw, max)
}

function pushDistinctAll(arr: string[], text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return
  const lc = cleaned.toLowerCase()
  if (arr.some(x => x.toLowerCase() === lc)) return
  arr.push(cleaned)
}

function evenlySample(values: string[], maxItems: number): string[] {
  if (values.length <= maxItems) return values
  if (maxItems <= 1) return values.slice(0, 1)
  const picked: string[] = []
  const seen = new Set<number>()
  for (let i = 0; i < maxItems; i++) {
    const idx = Math.round((values.length - 1) * (i / (maxItems - 1)))
    if (!seen.has(idx)) {
      seen.add(idx)
      picked.push(values[idx])
    }
  }
  return picked
}

function collectClaudeContent(content: any, assistants: string[]) {
  if (typeof content === 'string') {
    pushDistinctAll(assistants, cleanText(content, 500))
    return
  }
  if (!Array.isArray(content)) return
  for (const part of content) {
    if (typeof part === 'string') {
      pushDistinctAll(assistants, cleanText(part, 500))
    } else if (part?.type === 'text') {
      pushDistinctAll(assistants, cleanText(part.text ?? '', 500))
    }
  }
}

function collectCodexPayload(payload: any, assistants: string[]) {
  if (!payload) return
  if (payload.type === 'message' && payload.role === 'assistant') {
    pushDistinctAll(assistants, cleanText(extractContentText(payload.content), 500))
  } else if (payload.type === 'agent_message') {
    pushDistinctAll(assistants, cleanText(payload.message ?? '', 500))
  }
}

export function extractTitleContextSample(head: string): TitleContextSample {
  const users: string[] = []
  const assistants: string[] = []

  for (const line of head.split('\n')) {
    if (!line.trim()) continue

    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      if ((line.includes('"type":"user"') || line.includes('"type": "user"')) &&
          (line.includes('"role":"user"') || line.includes('"role": "user"'))) {
        pushDistinctAll(users, extractTextViaRegex(line) ?? '')
      }
      continue
    }

    if (o.type === 'user' && o.message?.role === 'user') {
      pushDistinctAll(users, cleanUserTitleText(extractContentText(o.message.content), 700))
      continue
    }

    if (o.type === 'assistant' && o.message?.role === 'assistant') {
      collectClaudeContent(o.message.content, assistants)
      continue
    }

    if (o.type === 'response_item') {
      const p = o.payload
      if (p?.type === 'message' && p.role === 'user') {
        const cleaned = cleanUserTitleText(extractContentText(p.content), 700)
        if (cleaned && !cleaned.startsWith('#')) pushDistinctAll(users, cleaned)
      } else {
        collectCodexPayload(p, assistants)
      }
      continue
    }

    if (o.type === 'event_msg') {
      const p = o.payload
      if (p?.type === 'user_message') {
        pushDistinctAll(users, cleanUserTitleText(p.message ?? '', 700))
      } else {
        collectCodexPayload(p, assistants)
      }
    }
  }

  return { users: evenlySample(users, 12), assistants: evenlySample(assistants, 3), tools: [] }
}

export function formatTitleContextSample(sample: TitleContextSample): string {
  const lines: string[] = []
  for (const u of sample.users) lines.push(`USER: ${u}`)
  for (const a of sample.assistants) lines.push(`ASSISTANT: ${a}`)
  return lines.join('\n').slice(0, 10000)
}

/**
 * Build a title-generation input from the session sample. User requests are the primary signal:
 * take a higher, evenly distributed set of queries, plus three evenly distributed assistant replies.
 */
export function extractTitleContext(head: string): string {
  const sample = extractTitleContextSample(head)
  return formatTitleContextSample(sample)
}

function looksLikeJsonlTranscript(text: string): boolean {
  let parsed = 0
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    if (!(s.startsWith('{') && s.endsWith('}'))) continue
    try {
      const o = JSON.parse(s)
      if (o && typeof o === 'object' && ('type' in o || 'timestamp' in o || 'payload' in o)) parsed++
    } catch {}
    if (parsed >= 1) return true
  }
  return false
}

/**
 * Build the actual text handed to the title agent.
 * For structured transcripts, only extracted user/assistant/tool clues are valid input.
 * Raw JSONL metadata is intentionally not a fallback because agents tend to turn it
 * into refusal prose ("I don't see the session clues...") that then gets saved as a title.
 */
export function titleInputFromTranscript(text: string): string {
  const sampled = extractTitleContext(text) || extractUserGist(text)
  if (sampled) return sampled
  const fallback = replaceImagePathReferences(stripNoise(text)).replace(/\s+/g, ' ').trim()
  if (!fallback || looksLikeJsonlTranscript(fallback)) return ''
  return fallback.slice(0, 5000)
}

function taskTitleFromBerthStartPrompt(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const zh = normalized.match(/^请开始处理任务[：:]\s*「(.+?)」。?/)
  if (zh?.[1]?.trim()) return zh[1].trim()
  const en = normalized.match(/^Please start working on the task:\s*"(.+?)"\.?/)
  if (en?.[1]?.trim()) return en[1].trim()
  return null
}

export function deriveTitleFromTranscript(head: string): string | null {
  const sample = extractTitleContextSample(head)
  const firstUser = sample.users[0]
  if (!firstUser) return null
  const berthTaskTitle = taskTitleFromBerthStartPrompt(firstUser)
  if (berthTaskTitle) return berthTaskTitle
  const process = sample.assistants[0] ?? ''
  if (!process) return firstUser
  return `${firstUser} / ${process}`
}
