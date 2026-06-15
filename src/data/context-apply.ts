// src/data/context-apply.ts
// Pure, deterministic write-back of a consolidation result into a context doc: append a progress
// line to the log section, and overwrite the "current status" section body. Never touches other
// (stable) sections. The LLM only PRODUCES progress/status text — this is what actually edits.

export interface ConsolidationPatch { progress: string; status: string }
export interface ConsolidationHeadings { logHeading: string; statusHeading: string }

const HEADING_RE = /^#{1,6}\s/
const COMMENT_RE = /^\s*<!--.*-->\s*$/

/** Section body line range [start,end) for a heading line index (exclusive of the heading itself). */
function sectionRange(lines: string[], headingIdx: number): [number, number] {
  let end = headingIdx + 1
  while (end < lines.length && !HEADING_RE.test(lines[end])) end++
  return [headingIdx + 1, end]
}

export function applyConsolidation(doc: string, patch: ConsolidationPatch, headings: ConsolidationHeadings): string {
  const progress = patch.progress.trim()
  const status = patch.status.trim()
  if (!progress && !status) return doc

  let lines = doc.split('\n')

  // 1) Overwrite status section body (preserve heading + a leading comment line if present).
  if (status) {
    const sIdx = lines.findIndex(l => l.trim() === headings.statusHeading.trim())
    if (sIdx !== -1) {
      const [bStart, bEnd] = sectionRange(lines, sIdx)
      let insertAt = bStart
      while (insertAt < bEnd && COMMENT_RE.test(lines[insertAt])) insertAt++
      const newBody = [status, '']
      lines = [...lines.slice(0, insertAt), ...newBody, ...lines.slice(bEnd)]
    }
  }

  // 2) Append progress line at the end of the log section (after its last non-empty body line).
  if (progress) {
    const lIdx = lines.findIndex(l => l.trim() === headings.logHeading.trim())
    if (lIdx !== -1) {
      const [bStart, bEnd] = sectionRange(lines, lIdx)
      let lastContent = bStart - 1
      for (let i = bStart; i < bEnd; i++) if (lines[i].trim()) lastContent = i
      const entry = `- ${progress}`
      lines = [...lines.slice(0, lastContent + 1), entry, ...lines.slice(lastContent + 1)]
    }
  }

  return lines.join('\n')
}
