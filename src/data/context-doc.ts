// src/data/context-doc.ts
// Lazily create an entity's context file from the template, and mechanically roll its progress log.
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { DocStore } from './docstore'
import { contextStrings, type Locale } from '../i18n'
import { rotateLog, appendLogEntry } from './context-log'

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

/** Append a dated entry to the context file's log section, then roll if it overflows. */
export function appendContextLogOnDisk(
  docStore: DocStore, contextAbs: string,
  cfg: { text: string; date: string; maxLines: number; keep: number; locale: Locale },
): { appended: boolean; rotated: boolean } {
  if (!existsSync(contextAbs)) return { appended: false, rotated: false }
  const c = contextStrings(cfg.locale)
  const doc0 = readFileSync(contextAbs, 'utf8')
  const { doc, appended } = appendLogEntry({ doc: doc0, logHeading: c.logHeading, date: cfg.date, text: cfg.text })
  if (!appended) return { appended: false, rotated: false }
  docStore.writeDoc(contextAbs, doc)
  const rotated = rotateContextDocOnDisk(docStore, contextAbs, { maxLines: cfg.maxLines, keep: cfg.keep, locale: cfg.locale })
  return { appended: true, rotated }
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
