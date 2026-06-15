import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * Locate the static frontend directory by walking up from `startDir` until a `public/index.html` is
 * found. This makes the path robust to BOTH layouts: dev (running `src/server/index.ts` via tsx, where
 * public is two levels up) and packaged (compiled `dist/server/index.js`, where public sits at the
 * package root alongside `dist/`). A single `import.meta.url`-relative path can't cover both.
 */
export function resolvePublicDir(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'public')
    if (existsSync(join(candidate, 'index.html'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break   // reached filesystem root
    dir = parent
  }
  throw new Error(`could not locate public/ (with index.html) above ${startDir}`)
}
