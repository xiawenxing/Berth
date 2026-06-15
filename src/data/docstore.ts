import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, resolve, sep, extname, dirname } from 'node:path'
import { berthHome } from '../paths'

// Berth owns markdown docs + their assets under a CONFIGURABLE root (app_setting.docsRoot).
// Default ~/.berth/docs/. Refs are paths relative to the root. Layout Berth designs/maintains:
//   tasks/<task-id>/index.md   project docs: projects/<name>/index.md   assets: assets/<file>
// Path-traversal guards confine everything to the root.
//
// NOTE: when an external adapter uses detailDocFormat='obsidian', it assumes docsRoot == the
// Obsidian vault root (obsidian file= params are vault-relative), so an existing ref like
// `projects/foo.md` keeps resolving. See feishu adapter externalToRef/refToExternal.

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
}

export class DocStore {
  constructor(public readonly root: string) {}

  /**
   * Save a base64 data-URL image under <root>/<destDir>/assets. `destDir` is the root-relative
   * directory of the NOTE that will embed the image (e.g. `tasks/<id>`); the returned `rel` is
   * therefore relative to that note (`assets/<file>`) so the markdown `![](rel)` resolves correctly
   * both in Obsidian and in Berth's preview. `destDir` defaults to '' (root). Returns null if the
   * payload isn't a supported image or `destDir` escapes the root.
   */
  saveAttachment(dataUrl: string, nameHint: string, destDir = ''): { rel: string; abs: string } | null {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl || '')
    if (!m) return null
    const ext = EXT_BY_MIME[m[1]]
    if (!ext) return null
    const dir = resolve(join(this.root, destDir, 'assets'))
    if (dir !== this.root && !dir.startsWith(this.root + sep)) return null   // anti-traversal
    mkdirSync(dir, { recursive: true })
    const safe = (nameHint || 'img').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'img'
    const file = `${safe}-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`
    const abs = join(dir, file)
    writeFileSync(abs, Buffer.from(m[2], 'base64'))
    return { rel: `assets/${file}`, abs }
  }

  /** Resolve any asset (image) path under the root, for serving. */
  resolveAssetPath(input: string): string | null {
    if (!input) return null
    const abs = resolve(input.startsWith('/') ? input : join(this.root, input))
    if (abs !== this.root && !abs.startsWith(this.root + sep)) return null
    return abs
  }

  /**
   * Resolve a doc reference to an absolute path GUARANTEED to live inside the root. Accepts an
   * `obsidian://...&file=<path>` link (legacy external format), an absolute path, or a root-relative
   * path. Returns null if it escapes the root or isn't a .md file.
   */
  resolveDocPath(input: string): string | null {
    if (!input) return null
    let p: string
    // The value may be markdown-wrapped: "[obsidian://...&file=projects%2Fx](http://...)" — extract
    // the file= param from anywhere rather than assuming a clean URL.
    const m = input.match(/[?&]file=([^&\]\)\s"']+)/)
    if (m) {
      let file: string
      try { file = decodeURIComponent(m[1]) } catch { file = m[1] }
      p = join(this.root, file.endsWith('.md') ? file : file + '.md')   // obsidian omits .md
    } else if (input.startsWith('obsidian://')) {
      return null   // obsidian link with no file param
    } else {
      const base = input.startsWith('/') ? input : join(this.root, input)
      p = extname(base) === '' ? base + '.md' : base   // only auto-append .md when no extension
    }
    const abs = resolve(p)
    if (extname(abs) !== '.md') return null
    if (abs !== this.root && !abs.startsWith(this.root + sep)) return null   // anti-traversal
    return abs
  }

  readDoc(abs: string): { content: string; mtime: number } {
    return { content: readFileSync(abs, 'utf8'), mtime: Math.floor(statSync(abs).mtimeMs) }
  }

  writeDoc(abs: string, content: string): { mtime: number } {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    return { mtime: Math.floor(statSync(abs).mtimeMs) }
  }

  docMtime(abs: string): number | null {
    try { return Math.floor(statSync(abs).mtimeMs) } catch { return null }
  }

  /** Internal ref for a task's detail doc. */
  taskDocRef(taskId: string): string { return `tasks/${taskId}/index.md` }
  /** Internal ref for a project's doc. */
  projectDocRef(name: string): string { return `projects/${name}/index.md` }
}

export const DEFAULT_DOCS_ROOT = join(berthHome(), 'docs')

interface HasSetting { getSetting(key: string): string | null }

export function getDocsRoot(store: HasSetting): string {
  return store.getSetting('docsRoot') ?? DEFAULT_DOCS_ROOT
}

const cache = new Map<string, DocStore>()
export function getDocStore(store: HasSetting): DocStore {
  const root = getDocsRoot(store)
  let ds = cache.get(root)
  if (!ds) { ds = new DocStore(root); cache.set(root, ds) }
  return ds
}

// A lazily-registered store so code far from store-singleton (e.g. pty-registry's image-paste path)
// can resolve the current DocStore without importing the singleton (avoids an import cycle).
let registered: HasSetting | null = null
export function setDocStoreStore(store: HasSetting): void { registered = store }
export function currentDocStore(): DocStore {
  return getDocStore(registered ?? { getSetting: () => null })
}
