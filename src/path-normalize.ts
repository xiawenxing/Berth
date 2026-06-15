import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Canonicalize a filesystem path for equality checks.
 *
 * Existing paths use realpath so platform aliases collapse (macOS: /tmp -> /private/tmp).
 * Missing paths still get a stable absolute/NFC key.
 */
export function canonicalPathKey(p: string): string {
  let abs = resolve(p)
  try { abs = realpathSync.native(abs) } catch {
    try { abs = realpathSync(abs) } catch {}
  }
  return abs.normalize('NFC')
}
