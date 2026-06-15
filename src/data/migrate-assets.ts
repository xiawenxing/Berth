import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'
import { DocStore } from './docstore'

type Store = ReturnType<typeof import('../db/store').openStore>

// Markdown image refs: ![alt](path)
const IMG_RE = /!\[[^\]]*\]\(([^)]+)\)/g

function within(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root + sep)
}

/**
 * One-time, COPY-ONLY repair for task-detail images saved before assets were co-located with their
 * note. The old `saveAttachment` wrote every image to `<root>/assets/<file>` but embedded it as the
 * note-relative `![](assets/<file>)`, which resolves to `<root>/tasks/<id>/assets/<file>` — a missing
 * file. For each task detail doc whose relative image target is missing next to the note but DOES
 * exist at the old `<root>/<ref>` location, copy the file into place.
 *
 * Copy-only by design: docsRoot may be a shared Obsidian vault, so we never delete or move anything
 * from `<root>/assets` (that could break the user's unrelated notes). Confined to the root and
 * guarded to run once (`assets-migrated`). Returns the number of files copied.
 */
export function migrateAttachmentsOnce(store: Store, ctx: { docsRoot: string }): number {
  if (store.getSetting('assets-migrated')) return 0
  const ds = new DocStore(ctx.docsRoot)
  const root = resolve(ctx.docsRoot)
  let copied = 0
  for (const t of store.allTasks(true)) {
    if (!t.detailDoc) continue
    const docAbs = ds.resolveDocPath(t.detailDoc)
    if (!docAbs || !existsSync(docAbs)) continue
    const docDir = dirname(docAbs)
    let content: string
    try { content = readFileSync(docAbs, 'utf8') } catch { continue }
    for (const m of content.matchAll(IMG_RE)) {
      let p = m[1].trim()
      if (/^(https?:|data:|blob:|obsidian:|\/)/i.test(p)) continue
      if (p.startsWith('./')) p = p.slice(2)
      let rel: string
      try { rel = decodeURIComponent(p) } catch { rel = p }
      const target = resolve(join(docDir, rel))
      if (!within(target, root) || existsSync(target)) continue
      const source = resolve(join(root, rel))          // the old root-relative storage location
      if (source === target || !within(source, root) || !existsSync(source)) continue
      try { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); copied++ }
      catch { /* best-effort per file */ }
    }
  }
  store.setSetting('assets-migrated', '1')
  return copied
}
