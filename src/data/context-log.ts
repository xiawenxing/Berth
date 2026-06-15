// src/data/context-log.ts
// Pure, deterministic rolling of an append-only progress-log section out of a context doc into a
// sibling archive. No filesystem, no LLM — Berth runs this on PTY exit as the §7 Phase-1 fallback.

export interface RotateInput {
  doc: string          // full context-doc markdown
  archive: string      // existing archive markdown ('' if none yet)
  logHeading: string   // e.g. '## 进展日志'
  pointerLine: string  // e.g. '> 更早进展见 [归档](progress-archive.md)'
  archiveTitle: string // e.g. '# 进展归档'
  maxLines: number     // roll when entry count EXCEEDS this
  keep: number         // entries to keep in the live doc after a roll
}

export interface RotateResult {
  rotated: boolean
  doc: string
  archive: string
}

const HEADING_RE = /^#{1,6}\s/
const ENTRY_RE = /^\s*-\s/

/** Roll the log section if it has more than `maxLines` entries. Returns inputs unchanged when not rolled. */
export function rotateLog(input: RotateInput): RotateResult {
  const { doc, archive, logHeading, pointerLine, archiveTitle, maxLines, keep } = input
  const lines = doc.split('\n')
  const headIdx = lines.findIndex(l => l.trim() === logHeading.trim())
  if (headIdx === -1) return { rotated: false, doc, archive }

  // Section spans from the line after the heading to the next markdown heading (or EOF).
  let end = headIdx + 1
  while (end < lines.length && !HEADING_RE.test(lines[end])) end++

  const sectionLines = lines.slice(headIdx + 1, end)
  const entries = sectionLines.filter(l => ENTRY_RE.test(l))
  if (entries.length <= maxLines) return { rotated: false, doc, archive }

  const archivedEntries = entries.slice(0, entries.length - keep)   // older block, original order
  const keptEntries = entries.slice(entries.length - keep)          // most-recent `keep`

  // Rebuild the live section: heading, pointer (once), blank, kept entries, blank.
  const newSection = [pointerLine, '', ...keptEntries, '']
  const newDocLines = [...lines.slice(0, headIdx + 1), ...newSection, ...lines.slice(end)]
  const newDoc = newDocLines.join('\n')

  // Prepend the newly-archived block above any existing archive body (title kept single, on top).
  const prevBody = stripArchiveTitle(archive, archiveTitle).trim()
  const archiveParts = [archiveTitle, '', ...archivedEntries]
  if (prevBody) archiveParts.push('', prevBody)
  const newArchive = archiveParts.join('\n') + '\n'

  return { rotated: true, doc: newDoc, archive: newArchive }
}

export interface LogEntry { date: string | null; text: string }

const DATED_RE = /^\s*-\s*(\d{4}-\d{2}-\d{2})\s*:\s*(.*)$/
const BULLET_RE = /^\s*-\s+(.*)$/

/** Parse the last `n` entries of the log section (newest last). Empty if the heading is absent. */
export function lastLogEntries(doc: string, logHeading: string, n: number): LogEntry[] {
  const lines = doc.split('\n')
  const headIdx = lines.findIndex(l => l.trim() === logHeading.trim())
  if (headIdx === -1) return []
  let end = headIdx + 1
  while (end < lines.length && !HEADING_RE.test(lines[end])) end++

  const entries: LogEntry[] = []
  for (const l of lines.slice(headIdx + 1, end)) {
    const dm = DATED_RE.exec(l)
    if (dm) { entries.push({ date: dm[1], text: dm[2].trim() }); continue }
    const bm = BULLET_RE.exec(l)
    if (bm) entries.push({ date: null, text: bm[1].trim() })
  }
  return entries.slice(Math.max(0, entries.length - n))
}

function stripArchiveTitle(archive: string, title: string): string {
  if (!archive.trim()) return ''
  const lines = archive.split('\n')
  if (lines[0]?.trim() === title.trim()) return lines.slice(1).join('\n')
  return archive
}

export interface AppendInput {
  doc: string          // full context-doc markdown
  logHeading: string   // e.g. '## 进展日志'
  date: string         // 'YYYY-MM-DD'
  text: string         // entry body; internal whitespace/newlines are collapsed to single spaces
}

/** Append a `- <date>: <text>` line to the bottom of the log section. No-op if the heading is absent. */
export function appendLogEntry(input: AppendInput): { doc: string; appended: boolean } {
  const { doc, logHeading, date, text } = input
  const lines = doc.split('\n')
  const headIdx = lines.findIndex(l => l.trim() === logHeading.trim())
  if (headIdx === -1) return { doc, appended: false }

  let end = headIdx + 1
  while (end < lines.length && !HEADING_RE.test(lines[end])) end++

  const section = lines.slice(headIdx + 1, end)
  let lastNonBlank = section.length
  while (lastNonBlank > 0 && section[lastNonBlank - 1].trim() === '') lastNonBlank--

  const oneLine = text.replace(/\s+/g, ' ').trim()
  const entry = `- ${date}: ${oneLine}`
  const newSection = [...section.slice(0, lastNonBlank), entry, '']
  const newLines = [...lines.slice(0, headIdx + 1), ...newSection, ...lines.slice(end)]
  return { doc: newLines.join('\n'), appended: true }
}
