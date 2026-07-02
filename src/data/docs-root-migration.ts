import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getDocsRoot } from './docstore'

interface HasDocsRootSetting {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export interface DocsRootMigrationResult {
  from: string
  to: string
  changed: boolean
  copied: number
  unchanged: number
  conflicts: string[]
}

export class DocsRootMigrationConflict extends Error {
  constructor(public readonly result: DocsRootMigrationResult) {
    super(`docsRoot migration has ${result.conflicts.length} conflicting file(s)`)
  }
}

const MANAGED_ENTRIES = ['tasks', 'projects', 'AGENTS.md']
const IMG_RE = /!\[[^\]]*\]\(([^)]+)\)/g

function within(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root + sep)
}

export function normalizeDocsRoot(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('docsRoot required')
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  return resolve(isAbsolute(expanded) ? expanded : join(process.cwd(), expanded))
}

function collectFiles(abs: string, skipRoot: string): string[] {
  if (!existsSync(abs)) return []
  const st = statSync(abs)
  if (within(abs, skipRoot)) return []
  if (st.isFile()) return [abs]
  if (!st.isDirectory()) return []
  const files: string[] = []
  for (const name of readdirSync(abs)) files.push(...collectFiles(join(abs, name), skipRoot))
  return files
}

function sameFile(a: string, b: string): boolean {
  try {
    const as = statSync(a)
    const bs = statSync(b)
    if (as.size !== bs.size) return false
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

function markdownImageRefs(mdAbs: string): string[] {
  let content = ''
  try { content = readFileSync(mdAbs, 'utf8') } catch { return [] }
  const refs: string[] = []
  for (const m of content.matchAll(IMG_RE)) {
    let p = m[1].trim()
    if (!p || /^(https?:|data:|blob:|obsidian:|\/)/i.test(p)) continue
    if (p.startsWith('./')) p = p.slice(2)
    try { p = decodeURIComponent(p) } catch {}
    refs.push(p)
  }
  return refs
}

/**
 * Switch the docstore root after copy-migrating Berth-owned docs. This is copy-only and scoped to
 * the managed layout (`tasks/`, `projects/`, root `AGENTS.md`, legacy root `assets/`), so pointing an
 * old root at a shared Obsidian vault never copies unrelated notes.
 */
export function migrateDocsRoot(store: HasDocsRootSetting, nextRootInput: string): DocsRootMigrationResult {
  const from = normalizeDocsRoot(getDocsRoot(store))
  const to = normalizeDocsRoot(nextRootInput)
  const base: DocsRootMigrationResult = { from, to, changed: from !== to, copied: 0, unchanged: 0, conflicts: [] }
  if (from === to) {
    store.setSetting('docsRoot', to)
    return base
  }

  if (existsSync(to) && !statSync(to).isDirectory()) throw new Error(`docsRoot is not a directory: ${to}`)

  const sources = MANAGED_ENTRIES.flatMap((entry) => collectFiles(join(from, entry), to))
  const plan = sources.map((src) => {
    const rel = relative(from, src)
    return { src, rel, dest: join(to, rel) }
  }).filter((x) => x.rel && !x.rel.startsWith('..') && !isAbsolute(x.rel))

  for (const md of sources.filter((src) => src.endsWith('.md'))) {
    const docRelDir = dirname(relative(from, md))
    for (const ref of markdownImageRefs(md)) {
      const noteRelativeSource = resolve(join(dirname(md), ref))
      if (within(noteRelativeSource, from) && existsSync(noteRelativeSource)) {
        const rel = relative(from, noteRelativeSource)
        plan.push({ src: noteRelativeSource, rel, dest: join(to, rel) })
        continue
      }
      // Older Berth builds wrote images to <root>/assets but embedded them as note-relative
      // `assets/<file>`. Copy those into the note-relative location so the migrated markdown works.
      const legacyRootSource = resolve(join(from, ref))
      if (within(legacyRootSource, from) && existsSync(legacyRootSource)) {
        const rel = join(docRelDir, ref)
        plan.push({ src: legacyRootSource, rel, dest: join(to, rel) })
      }
    }
  }

  const dedupedPlan = [...new Map(plan.map((item) => [`${item.dest}\0${item.src}`, item])).values()]

  for (const item of dedupedPlan) {
    if (!existsSync(item.dest)) continue
    if (sameFile(item.src, item.dest)) base.unchanged++
    else base.conflicts.push(item.rel)
  }
  if (base.conflicts.length) throw new DocsRootMigrationConflict(base)

  mkdirSync(to, { recursive: true })
  for (const item of dedupedPlan) {
    if (existsSync(item.dest)) continue
    mkdirSync(dirname(item.dest), { recursive: true })
    copyFileSync(item.src, item.dest)
    base.copied++
  }
  store.setSetting('docsRoot', to)
  return base
}
