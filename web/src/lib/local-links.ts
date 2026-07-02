/**
 * URL schemes Berth treats as "open this on the host" links (the browser can't navigate to them).
 * Kept as an explicit ALLOWLIST rather than "any scheme://" on purpose: the markdown sanitizer
 * (`mdToSafeHtml`) must widen its href filter to exactly this set, and allowing arbitrary schemes
 * there would re-admit `javascript://` / `data:` XSS vectors. Both `isLocalHref` and the sanitizer's
 * URI allowlist are built from this one constant so they can never drift. Add a scheme here to
 * support another app protocol (e.g. `cursor`, `zed`) — it must be safe to hand to the OS `open`.
 */
export const LOCAL_OPEN_SCHEMES = ['file', 'obsidian', 'vscode'] as const

/**
 * True when a raw markdown href points at a LOCAL file address that the browser cannot navigate to
 * and Berth must open via the host: an absolute or `~` path, or one of `LOCAL_OPEN_SCHEMES`
 * (file:// / obsidian:// / vscode://). http(s), mailto, tel, in-page anchors and protocol-relative
 * URLs are left to default browser behavior. Read the link's getAttribute('href') (the RAW value) —
 * never `.href`, which the browser would resolve "/Users/…" into a same-origin URL.
 */
export function isLocalHref(href: string): boolean {
  const h = href.trim()
  if (h === '') return false
  if (h.startsWith('#')) return false
  if (/^https?:\/\//i.test(h)) return false
  if (/^(mailto|tel):/i.test(h)) return false
  if (h === '~' || h.startsWith('~/')) return true
  if (h.startsWith('/') && !h.startsWith('//')) return true
  const scheme = h.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)?.[1]?.toLowerCase()
  return scheme !== undefined && (LOCAL_OPEN_SCHEMES as readonly string[]).includes(scheme)
}
