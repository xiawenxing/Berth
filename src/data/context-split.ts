import { basename } from 'node:path'
import type { Locale } from '../i18n'

export interface CompactContextInput {
  doc: string
  maxChars: number
  keepChars: number
  referenceRel: string
  date: string
  locale: Locale
  logHeading: string
  logKeep: number
}

export interface CompactContextResult {
  compacted: boolean
  doc: string
  reference: string
}

interface Section {
  heading: string
  body: string
}

const H1_RE = /^#\s+(.+)$/m
const H2_RE = /^##\s+.+$/gm
const BULLET_RE = /^\s*-\s+/m

function labels(locale: Locale) {
  if (locale === 'zh-CN') {
    return {
      referenceHeading: '## 参考子文档',
      generatedTitle: '上下文参考',
      generatedNote: '主上下文超过长度阈值后自动拆分；主文档保留摘要与最近进展，完整拆分前内容保存在本文。',
      summaryHeading: '## 摘要',
      archivedHeading: '## 拆分前完整上下文',
      movedNote: (rel: string) => `> 更早的详细内容已拆分到 [${basename(rel)}](${rel})。`,
      refBullet: (date: string, rel: string, title: string, chars: number) => `- ${date}: [${title}](${rel})（拆分前约 ${chars} 字符）`,
      empty: '暂无可提取摘要。',
    }
  }
  return {
    referenceHeading: '## Reference documents',
    generatedTitle: 'Context reference',
    generatedNote: 'Generated after the main context exceeded its length threshold; the main document keeps summaries and recent progress, while this file preserves the complete pre-split content.',
    summaryHeading: '## Summary',
    archivedHeading: '## Full pre-split context',
    movedNote: (rel: string) => `> Older detailed notes were split into [${basename(rel)}](${rel}).`,
    refBullet: (date: string, rel: string, title: string, chars: number) => `- ${date}: [${title}](${rel}) (about ${chars} chars before split)`,
    empty: 'No extractable summary yet.',
  }
}

function titleOf(doc: string): string {
  return H1_RE.exec(doc)?.[1]?.trim() || 'Context'
}

function splitSections(doc: string): { preamble: string; sections: Section[] } {
  const matches = Array.from(doc.matchAll(H2_RE))
  if (!matches.length) return { preamble: doc.trim(), sections: [] }
  const first = matches[0].index ?? 0
  const sections = matches.map((m, i) => {
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? doc.length) : doc.length
    const chunk = doc.slice(start, end)
    const nl = chunk.indexOf('\n')
    return {
      heading: (nl === -1 ? chunk : chunk.slice(0, nl)).trim(),
      body: (nl === -1 ? '' : chunk.slice(nl + 1)).trim(),
    }
  })
  return { preamble: doc.slice(0, first).trim(), sections }
}

function stripNoise(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => m.replace(/\]\([^)]+\)/, ']'))
    .replace(/\s+/g, ' ')
    .trim()
}

function clipWords(s: string, limit: number): string {
  const clean = stripNoise(s)
  if (clean.length <= limit) return clean
  const clipped = clean.slice(0, Math.max(0, limit - 1))
  const cut = clipped.lastIndexOf(' ')
  return (cut > limit * 0.65 ? clipped.slice(0, cut) : clipped).trimEnd() + '…'
}

function lastBullets(body: string, keep: number): string[] {
  return body.split('\n').filter((l) => BULLET_RE.test(l)).slice(-keep)
}

function summarizeSection(section: Section, empty: string): string {
  const bullets = lastBullets(section.body, 3).map((l) => clipWords(l.replace(/^\s*-\s+/, ''), 180)).filter(Boolean)
  const summary = bullets.length ? bullets.join('; ') : clipWords(section.body, 240)
  return `- ${section.heading.replace(/^##\s+/, '')}: ${summary || empty}`
}

function compactBody(section: Section, opts: { budget: number; logHeading: string; logKeep: number; note: string }): string {
  if (section.heading.trim() === opts.logHeading.trim()) {
    const preserved = section.body.split('\n').filter((l) => l.trim().startsWith('>')).join('\n')
    const entries = lastBullets(section.body, opts.logKeep)
    return [preserved, entries.join('\n'), opts.note].filter(Boolean).join('\n\n')
  }
  const clean = stripNoise(section.body)
  if (clean.length <= opts.budget) return section.body
  return [clipWords(section.body, opts.budget), opts.note].join('\n\n')
}

function buildMainDoc(input: CompactContextInput, sections: Section[], referenceBody: string): string {
  const l = labels(input.locale)
  const note = l.movedNote(input.referenceRel)
  const nonRefSections = sections.filter((s) => s.heading.trim() !== l.referenceHeading)
  const attempts = [1600, 900, 450, 220]
  const preamble = splitSections(input.doc).preamble || `# ${titleOf(input.doc)}`

  for (const budget of attempts) {
    const parts = [preamble, '', l.referenceHeading, referenceBody.trim(), '']
    for (const section of nonRefSections) {
      parts.push(section.heading, compactBody(section, { budget, logHeading: input.logHeading, logKeep: input.logKeep, note }), '')
    }
    const doc = parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
    if (doc.length <= input.keepChars || budget === attempts[attempts.length - 1]) return doc
  }
  return input.doc
}

export function compactContextDoc(input: CompactContextInput): CompactContextResult {
  if (input.maxChars <= 0 || input.doc.length <= input.maxChars) {
    return { compacted: false, doc: input.doc, reference: '' }
  }
  const l = labels(input.locale)
  const title = titleOf(input.doc)
  const { sections } = splitSections(input.doc)
  const existingRef = sections.find((s) => s.heading.trim() === l.referenceHeading)?.body.trim()
  const refBullet = l.refBullet(input.date, input.referenceRel, l.generatedTitle, input.doc.length)
  const referenceBody = [existingRef, refBullet].filter(Boolean).join('\n')
  const summary = sections
    .filter((s) => s.heading.trim() !== l.referenceHeading)
    .map((s) => summarizeSection(s, l.empty))
    .join('\n') || `- ${clipWords(input.doc, 260) || l.empty}`
  const reference = [
    `# ${title} — ${l.generatedTitle}`,
    '',
    `> ${l.generatedNote}`,
    '',
    l.summaryHeading,
    summary,
    '',
    l.archivedHeading,
    '',
    input.doc.trimEnd(),
    '',
  ].join('\n')
  return { compacted: true, doc: buildMainDoc(input, sections, referenceBody), reference }
}

