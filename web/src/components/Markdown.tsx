import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isExternalHref, isLocalHref, LOCAL_OPEN_SCHEMES } from '../lib/local-links'
import { api } from '../lib/api'

// Render agent chat text as markdown. Agent output is markdown-heavy (code fences, bold, headings,
// lists), so the chat (Model B) view parses it. Safety: marked → DOMPurify sanitize before injecting,
// so any HTML/script the model emits can't execute. GitHub-flavored line breaks (single \n → <br>).
marked.setOptions({ gfm: true, breaks: true })

// DOMPurify's default URI allowlist is http(s)/mailto/tel/ftp/etc — it STRIPS the href for `file://`
// and our app schemes (obsidian://, vscode://), which would silently kill local-file links before
// the click handler ever sees them. Widen the allowlist to also admit LOCAL_OPEN_SCHEMES. This is a
// scoped addition to DOMPurify's default regexp (NOT `ALLOW_UNKNOWN_PROTOCOLS`, which would re-admit
// `javascript:`/`data:` XSS). Absolute and `~` paths already pass via the default `[^a-z]` branch.
const ALLOWED_URI_REGEXP = new RegExp(
  `^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|${LOCAL_OPEN_SCHEMES.join('|')}):|[^a-z]|[a-z+.-]+(?:[^a-z+.\\-:]|$))`,
  'i',
)

/** Parse markdown → sanitized HTML string. Pure + testable; any script/event-handler HTML is stripped. */
export function mdToSafeHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, ALLOWED_URI_REGEXP })
}

/**
 * Click delegation for rendered markdown: if the click lands on an <a> whose RAW href is a local-file
 * address, swallow the (doomed) navigation and ask the host to open it instead. Pure w.r.t. React so
 * it's unit-testable with a plain {target, preventDefault} stub.
 */
export function handleMarkdownClick(
  e: { target: EventTarget | null; preventDefault: () => void },
  openLocal: (href: string) => void,
  openExternal: (href: string) => void = (href) => window.open(href, '_blank', 'noopener,noreferrer'),
): void {
  const el = e.target as HTMLElement | null
  const a = el?.closest?.('a') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (isLocalHref(href)) {
    e.preventDefault()
    openLocal(href)
    return
  }
  if (isExternalHref(href)) {
    e.preventDefault()
    openExternal(href)
  }
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => mdToSafeHtml(text), [text])
  return (
    <div
      className={`berth-md ${className}`}
      onClick={(e) => handleMarkdownClick(e, (href) => {
        // Failure UX is intentionally quiet (console only, no toast — see design doc). Surface the
        // server's structured reason (e.g. "file not found") so a dead link is at least diagnosable.
        api.openLocal(href)
          .then((r) => { if (!r.ok) console.warn('open-local failed:', r.error ?? 'unknown error', '—', href) })
          .catch((err) => console.warn('open-local request failed:', err, '—', href))
      })}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
