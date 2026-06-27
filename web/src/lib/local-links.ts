/**
 * True when a raw markdown href points at a LOCAL file address that the browser cannot navigate to
 * and Berth must open via the host (file://, an absolute or ~ path, or a custom scheme such as
 * obsidian:// / vscode://). http(s), mailto, tel, in-page anchors and protocol-relative URLs are
 * left to default browser behavior. Read the link's getAttribute('href') (the RAW value) — never
 * `.href`, which the browser would resolve "/Users/…" into a same-origin URL.
 */
export function isLocalHref(href: string): boolean {
  const h = href.trim()
  if (h === '') return false
  if (h.startsWith('#')) return false
  if (/^https?:\/\//i.test(h)) return false
  if (/^(mailto|tel):/i.test(h)) return false
  if (h.startsWith('file://')) return true
  if (h === '~' || h.startsWith('~/')) return true
  if (h.startsWith('/') && !h.startsWith('//')) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(h)) return true // custom scheme://
  return false
}
