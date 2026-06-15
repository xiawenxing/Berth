// src/data/doc-diff.ts
// Pure section-level diff of two markdown docs, keyed by heading text. Lets Berth tell the user which
// context sections an agent update actually touched — without trusting the agent to self-report.

export interface SectionDiff { changed: string[]; added: string[]; removed: string[] }

const HEADING_RE = /^#{1,6}\s+(.*)$/

/** heading-text → trimmed body (lines under it until the next heading). Insertion order preserved. */
export function splitSections(md: string): Map<string, string> {
  const out = new Map<string, string>()
  let cur: string | null = null
  let buf: string[] = []
  const flush = () => { if (cur !== null) out.set(cur, buf.join('\n').trim()) }
  for (const l of md.split('\n')) {
    const m = HEADING_RE.exec(l)
    if (m) { flush(); cur = m[1].trim(); buf = [] }
    else if (cur !== null) buf.push(l)
  }
  flush()
  return out
}

/** Sections changed / added / removed going from oldMd to newMd (compares trimmed bodies). */
export function diffSections(oldMd: string, newMd: string): SectionDiff {
  const a = splitSections(oldMd), b = splitSections(newMd)
  const changed: string[] = [], added: string[] = [], removed: string[] = []
  for (const [h, body] of b) {
    if (!a.has(h)) added.push(h)
    else if (a.get(h) !== body) changed.push(h)
  }
  for (const h of a.keys()) if (!b.has(h)) removed.push(h)
  return { changed, added, removed }
}
