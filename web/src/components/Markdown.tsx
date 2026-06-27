import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isLocalHref } from '../lib/local-links'
import { api } from '../lib/api'

// Render agent chat text as markdown. Agent output is markdown-heavy (code fences, bold, headings,
// lists), so the chat (Model B) view parses it. Safety: marked → DOMPurify sanitize before injecting,
// so any HTML/script the model emits can't execute. GitHub-flavored line breaks (single \n → <br>).
marked.setOptions({ gfm: true, breaks: true })

/** Parse markdown → sanitized HTML string. Pure + testable; any script/event-handler HTML is stripped. */
export function mdToSafeHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}

/**
 * Click delegation for rendered markdown: if the click lands on an <a> whose RAW href is a local-file
 * address, swallow the (doomed) navigation and ask the host to open it instead. Pure w.r.t. React so
 * it's unit-testable with a plain {target, preventDefault} stub.
 */
export function handleMarkdownClick(
  e: { target: EventTarget | null; preventDefault: () => void },
  openLocal: (href: string) => void,
): void {
  const el = e.target as HTMLElement | null
  const a = el?.closest?.('a') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (!isLocalHref(href)) return
  e.preventDefault()
  openLocal(href)
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => mdToSafeHtml(text), [text])
  return (
    <div
      className={`berth-md ${className}`}
      onClick={(e) => handleMarkdownClick(e, (href) => { api.openLocal(href).catch((err) => console.warn('open-local failed', err)) })}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
