import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { berthHome } from '../paths'
import type { DataSourceRow } from './types'

type Store = ReturnType<typeof import('../db/store').openStore>

export interface SeedConfig {
  docsRoot?: string
  locale?: string   // 'en' | 'zh-CN' — agent-facing language for injected manifest/prompt (see src/i18n.ts)
  dataSources?: DataSourceRow[]
}

/**
 * Load first-run seed from a LOCAL, untracked source — never from repo constants. Order:
 *   1. <berthHome>/seed.json  (preferred; the owner's personal connection config lives here.
 *      <berthHome> = ~/.berth, or $BERTH_HOME for an isolated instance)
 *   2. BERTH_SEED_JSON env var (a JSON string), for headless setups.
 * Returns null when no seed is present (a fresh install configures sources via Settings instead).
 */
export function loadSeed(): SeedConfig | null {
  const path = join(berthHome(), 'seed.json')
  if (existsSync(path)) {
    try { return JSON.parse(readFileSync(path, 'utf8')) as SeedConfig } catch { /* ignore malformed */ }
  }
  if (process.env.BERTH_SEED_JSON) {
    try { return JSON.parse(process.env.BERTH_SEED_JSON) as SeedConfig } catch { /* ignore */ }
  }
  return null
}

/**
 * First-run bootstrap: seed app settings (docsRoot) + data sources from the local seed. Idempotent
 * (guarded by the `bootstrapped` flag). Safe to call every startup.
 */
export function ensureBootstrap(store: Store, seed: SeedConfig | null = loadSeed()): void {
  if (store.getSetting('bootstrapped')) return
  if (seed?.docsRoot) store.setSetting('docsRoot', seed.docsRoot)
  if (seed?.locale) store.setSetting('locale', seed.locale)
  if (seed?.dataSources) for (const ds of seed.dataSources) store.upsertDataSource(ds)
  store.setSetting('bootstrapped', '1')
}
