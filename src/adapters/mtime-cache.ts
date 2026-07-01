import { statSync } from 'node:fs'

/**
 * A per-file memo keyed on mtime. Session-store files are effectively append-only (a rollout/jsonl
 * gains turns; a session.json is rewritten), so an unchanged mtime means an unchanged parse result.
 * This turns "read+parse every file every scan" (hundreds of MB) into "stat every file (cheap), parse
 * only the few that changed". One cache instance lives per adapter in the server process.
 */
export interface MtimeCache<T> {
  /** Cached value if the file's mtime is unchanged; otherwise compute via `read`, cache, return. */
  resolve(path: string, read: () => T): T
  /** Evict entries for paths not in `livePaths` (call once per scan with the globbed set). */
  prune(livePaths: Iterable<string>): void
}

export function createMtimeCache<T>(
  statImpl: (p: string) => { mtimeMs: number } = statSync,
): MtimeCache<T> {
  const map = new Map<string, { mtimeMs: number; val: T }>()
  return {
    resolve(path, read) {
      let mtimeMs: number
      try { mtimeMs = statImpl(path).mtimeMs } catch { return read() }   // unstattable → don't cache
      const hit = map.get(path)
      if (hit && hit.mtimeMs === mtimeMs) return hit.val
      const val = read()
      map.set(path, { mtimeMs, val })
      return val
    },
    prune(livePaths) {
      const live = livePaths instanceof Set ? livePaths : new Set(livePaths)
      for (const k of map.keys()) if (!live.has(k)) map.delete(k)
    },
  }
}
