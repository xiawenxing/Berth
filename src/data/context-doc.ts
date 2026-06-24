// src/data/context-doc.ts
// Lazily create an entity's context file from the template, and mechanically roll its progress log.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { DocStore } from './docstore'
import { contextStrings, type Locale } from '../i18n'
import { rotateLog, appendLogEntry } from './context-log'
import { compactContextDoc } from './context-split'

export interface EnsuredDoc { ref: string; abs: string; created: boolean }

export interface EnsureOpts { title: string; projectName?: string | null; locale: Locale }

/** Ensure the context file for a task/project exists (created from template if missing). Never overwrites. */
export function ensureContextDoc(
  docStore: DocStore, kind: 'task' | 'project', key: string, opts: EnsureOpts,
): EnsuredDoc {
  const ref = kind === 'task' ? docStore.taskDocRef(key) : docStore.projectDocRef(key)
  const abs = docStore.resolveDocPath(ref)
  if (!abs) throw new Error(`context-doc: cannot resolve ref ${ref}`)
  if (existsSync(abs)) return { ref, abs, created: false }
  const c = contextStrings(opts.locale)
  const body = kind === 'task'
    ? c.taskTemplate(opts.title, opts.projectName ?? '—')
    : c.projectTemplate(opts.title)
  docStore.writeDoc(abs, body)
  return { ref, abs, created: true }
}

/** The progress-archive file sibling to a context file. */
export function archivePathFor(contextAbs: string): string {
  return join(dirname(contextAbs), 'progress-archive.md')
}

export function referencePathFor(contextAbs: string, stamp: string): { abs: string; rel: string } {
  const rel = `references/context-${stamp}.md`
  return { abs: join(dirname(contextAbs), rel), rel }
}

export interface ContextCompactionSummaryInput {
  doc: string
  fallbackDoc: string
  referenceRel: string
  date: string
  locale: Locale
  maxChars: number
  keepChars: number
  logHeading: string
  logKeep: number
}

export type ContextCompactionSummarizer = (input: ContextCompactionSummaryInput) => Promise<string | null>

function uniqueReferencePath(contextAbs: string, stamp: string): { abs: string; rel: string } {
  let n = 0
  while (true) {
    const suffix = n ? `-${n}` : ''
    const rel = `references/context-${stamp}${suffix}.md`
    const abs = join(dirname(contextAbs), rel)
    if (!existsSync(abs)) return { abs, rel }
    n += 1
  }
}

function stampFromDate(date: string): string {
  const safe = date.replace(/[^0-9A-Za-z-]/g, '')
  if (safe) return safe
  return new Date().toISOString().slice(0, 10)
}

export function compactContextDocOnDisk(
  docStore: DocStore, contextAbs: string,
  cfg: { maxChars: number; keepChars: number; logKeep: number; locale: Locale; date?: string },
): boolean {
  if (!existsSync(contextAbs)) return false
  const doc = readFileSync(contextAbs, 'utf8')
  if (doc.length <= cfg.maxChars) return false
  const ref = uniqueReferencePath(contextAbs, stampFromDate(cfg.date ?? new Date().toISOString()))
  const c = contextStrings(cfg.locale)
  const r = compactContextDoc({
    doc, maxChars: cfg.maxChars, keepChars: cfg.keepChars, referenceRel: ref.rel,
    date: cfg.date ?? new Date().toISOString().slice(0, 10),
    locale: cfg.locale, logHeading: c.logHeading, logKeep: cfg.logKeep,
  })
  if (!r.compacted) return false
  docStore.writeDoc(ref.abs, r.reference)
  docStore.writeDoc(contextAbs, r.doc)
  return true
}

function usableCompactedMain(doc: string | null | undefined, referenceRel: string, cfg: { maxChars: number }): string | null {
  const clean = (doc ?? '').trim()
  if (!clean || !clean.startsWith('#')) return null
  if (!clean.includes(referenceRel)) return null
  if (clean.length > cfg.maxChars) return null
  return clean + '\n'
}

export async function compactContextDocOnDiskAsync(
  docStore: DocStore, contextAbs: string,
  cfg: { maxChars: number; keepChars: number; logKeep: number; locale: Locale; date?: string },
  summarize?: ContextCompactionSummarizer,
): Promise<boolean> {
  if (!existsSync(contextAbs)) return false
  const doc = readFileSync(contextAbs, 'utf8')
  if (doc.length <= cfg.maxChars) return false
  const date = cfg.date ?? new Date().toISOString().slice(0, 10)
  const ref = uniqueReferencePath(contextAbs, stampFromDate(date))
  const c = contextStrings(cfg.locale)
  const r = compactContextDoc({
    doc, maxChars: cfg.maxChars, keepChars: cfg.keepChars, referenceRel: ref.rel,
    date, locale: cfg.locale, logHeading: c.logHeading, logKeep: cfg.logKeep,
  })
  if (!r.compacted) return false

  // Preserve first. The LLM can only improve the live main doc; the complete pre-split content is
  // already safely available from the reference child even if summarization fails.
  docStore.writeDoc(ref.abs, r.reference)

  let main = r.doc
  if (summarize) {
    try {
      main = usableCompactedMain(await summarize({
        doc, fallbackDoc: r.doc, referenceRel: ref.rel, date, locale: cfg.locale,
        maxChars: cfg.maxChars, keepChars: cfg.keepChars, logHeading: c.logHeading, logKeep: cfg.logKeep,
      }), ref.rel, { maxChars: cfg.maxChars }) ?? r.doc
    } catch {
      main = r.doc
    }
  }
  docStore.writeDoc(contextAbs, main)
  return true
}

export function maintainContextDocOnDisk(
  docStore: DocStore, contextAbs: string,
  cfg: { logMaxLines: number; logKeep: number; docMaxChars: number; docKeepChars: number; locale: Locale; date?: string },
): { rotated: boolean; compacted: boolean } {
  const rotated = rotateContextDocOnDisk(docStore, contextAbs, { maxLines: cfg.logMaxLines, keep: cfg.logKeep, locale: cfg.locale })
  const compacted = compactContextDocOnDisk(docStore, contextAbs, {
    maxChars: cfg.docMaxChars, keepChars: cfg.docKeepChars, logKeep: cfg.logKeep, locale: cfg.locale, date: cfg.date,
  })
  return { rotated, compacted }
}

export async function maintainContextDocOnDiskAsync(
  docStore: DocStore, contextAbs: string,
  cfg: { logMaxLines: number; logKeep: number; docMaxChars: number; docKeepChars: number; locale: Locale; date?: string },
  summarize?: ContextCompactionSummarizer,
): Promise<{ rotated: boolean; compacted: boolean }> {
  const rotated = rotateContextDocOnDisk(docStore, contextAbs, { maxLines: cfg.logMaxLines, keep: cfg.logKeep, locale: cfg.locale })
  const compacted = await compactContextDocOnDiskAsync(docStore, contextAbs, {
    maxChars: cfg.docMaxChars, keepChars: cfg.docKeepChars, logKeep: cfg.logKeep, locale: cfg.locale, date: cfg.date,
  }, summarize)
  return { rotated, compacted }
}

/** Append a dated entry to the context file's log section, then roll if it overflows. */
export function appendContextLogOnDisk(
  docStore: DocStore, contextAbs: string,
  cfg: { text: string; date: string; maxLines: number; keep: number; locale: Locale; maxChars?: number; keepChars?: number },
): { appended: boolean; rotated: boolean; compacted: boolean } {
  if (!existsSync(contextAbs)) return { appended: false, rotated: false, compacted: false }
  const c = contextStrings(cfg.locale)
  const doc0 = readFileSync(contextAbs, 'utf8')
  const { doc, appended } = appendLogEntry({ doc: doc0, logHeading: c.logHeading, date: cfg.date, text: cfg.text })
  if (!appended) return { appended: false, rotated: false, compacted: false }
  docStore.writeDoc(contextAbs, doc)
  const rotated = rotateContextDocOnDisk(docStore, contextAbs, { maxLines: cfg.maxLines, keep: cfg.keep, locale: cfg.locale })
  const compacted = cfg.maxChars && cfg.keepChars
    ? compactContextDocOnDisk(docStore, contextAbs, { maxChars: cfg.maxChars, keepChars: cfg.keepChars, logKeep: cfg.keep, locale: cfg.locale, date: cfg.date })
    : false
  return { appended: true, rotated, compacted }
}

export async function appendContextLogOnDiskAsync(
  docStore: DocStore, contextAbs: string,
  cfg: { text: string; date: string; maxLines: number; keep: number; locale: Locale; maxChars?: number; keepChars?: number },
  summarize?: ContextCompactionSummarizer,
): Promise<{ appended: boolean; rotated: boolean; compacted: boolean }> {
  if (!existsSync(contextAbs)) return { appended: false, rotated: false, compacted: false }
  const c = contextStrings(cfg.locale)
  const doc0 = readFileSync(contextAbs, 'utf8')
  const { doc, appended } = appendLogEntry({ doc: doc0, logHeading: c.logHeading, date: cfg.date, text: cfg.text })
  if (!appended) return { appended: false, rotated: false, compacted: false }
  docStore.writeDoc(contextAbs, doc)
  const rotated = rotateContextDocOnDisk(docStore, contextAbs, { maxLines: cfg.maxLines, keep: cfg.keep, locale: cfg.locale })
  const compacted = cfg.maxChars && cfg.keepChars
    ? await compactContextDocOnDiskAsync(docStore, contextAbs, {
        maxChars: cfg.maxChars, keepChars: cfg.keepChars, logKeep: cfg.keep, locale: cfg.locale, date: cfg.date,
      }, summarize)
    : false
  return { appended: true, rotated, compacted }
}

/** Read the context file + its archive, roll the log if over threshold, write both back. Returns whether it rolled. */
export function rotateContextDocOnDisk(
  docStore: DocStore, contextAbs: string, cfg: { maxLines: number; keep: number; locale: Locale },
): boolean {
  if (!existsSync(contextAbs)) return false
  const c = contextStrings(cfg.locale)
  const doc = readFileSync(contextAbs, 'utf8')
  const archiveAbs = archivePathFor(contextAbs)
  const archive = existsSync(archiveAbs) ? readFileSync(archiveAbs, 'utf8') : ''
  const r = rotateLog({
    doc, archive,
    logHeading: c.logHeading, pointerLine: c.archivePointer, archiveTitle: c.archiveTitle,
    maxLines: cfg.maxLines, keep: cfg.keep,
  })
  if (!r.rotated) return false
  docStore.writeDoc(contextAbs, r.doc)
  docStore.writeDoc(archiveAbs, r.archive)
  return true
}
