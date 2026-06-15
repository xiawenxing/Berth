/**
 * transcript.ts — shared helper for stripping hook/system/command-injected noise
 * from claude/codex/coco session transcript heads before title extraction.
 */

/** Markers that indicate hook-injected or system content, not real user messages. */
const HOOK_MARKERS = [
  'Conduit', 'B-role', 'conduit-hooks', 'SessionStart hook',
  'additionalContext', 'environment_context', 'user_instructions',
  '<EXTREMELY_IMPORTANT>', 'superpowers', 'using-superpowers',
]

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
    const cleaned = stripNoise(raw).replace(/\s+/g, ' ').trim()
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
      const cleaned = stripNoise(raw).replace(/\s+/g, ' ').trim()
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
      const cleaned = stripNoise(raw).replace(/\s+/g, ' ').trim()
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

/** Flatten claude message content (string or array) into plain text. */
function extractContentText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join(' ')
  }
  return ''
}
