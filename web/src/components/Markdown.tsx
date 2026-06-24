import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Render agent chat text as markdown. Agent output is markdown-heavy (code fences, bold, headings,
// lists), so the chat (Model B) view parses it. Safety: marked → DOMPurify sanitize before injecting,
// so any HTML/script the model emits can't execute. GitHub-flavored line breaks (single \n → <br>).
marked.setOptions({ gfm: true, breaks: true })

/** Parse markdown → sanitized HTML string. Pure + testable; any script/event-handler HTML is stripped. */
export function mdToSafeHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => mdToSafeHtml(text), [text])
  return <div className={`berth-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
