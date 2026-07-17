import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REPO = 'xiawenxing/Berth'
const CACHE_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 8000

export interface AppUpdateStatus {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  checkedAt: number | null
  error?: string | null
}

interface CacheEntry {
  key: string
  at: number
  status: AppUpdateStatus
}

let cache: CacheEntry | null = null

function packageRoot(startDir = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function currentAppVersion(): string {
  try {
    const root = packageRoot()
    if (!root) return '0.0.0'
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

function parts(version: string): number[] {
  return normalizeVersion(version)
    .split(/[.-]/)
    .map(p => Number.parseInt(p, 10))
    .map(n => (Number.isFinite(n) ? n : 0))
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parts(candidate)
  const b = parts(current)
  const n = Math.max(a.length, b.length, 3)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms).unref?.()
  return ctrl.signal
}

function errorStatus(currentVersion: string, checkedAt: number, error: unknown): AppUpdateStatus {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    checkedAt,
    error: String((error as any)?.message ?? error),
  }
}

export async function getAppUpdateStatus(opts: {
  currentVersion?: string
  repo?: string
  now?: number
  fetchImpl?: typeof fetch
  force?: boolean
} = {}): Promise<AppUpdateStatus> {
  const currentVersion = opts.currentVersion ?? currentAppVersion()
  const repo = opts.repo ?? DEFAULT_REPO
  const now = opts.now ?? Date.now()
  const key = `${repo}:${currentVersion}`
  if (!opts.force && cache && cache.key === key && now - cache.at < CACHE_MS) return cache.status

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    const status = errorStatus(currentVersion, now, new Error('fetch unavailable'))
    cache = { key, at: now, status }
    return status
  }

  try {
    const latestUrl = `https://github.com/${repo}/releases/latest`
    const res = await fetchImpl(latestUrl, {
      headers: {
        'User-Agent': `Berth/${currentVersion}`,
      },
      redirect: 'follow',
      signal: timeoutSignal(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`GitHub releases latest returned ${res.status}`)
    const releaseUrl = res.url || latestUrl
    const tag = releaseUrl.match(/\/releases\/tag\/([^/?#]+)/)?.[1] ?? null
    const latestVersion = tag ? normalizeVersion(decodeURIComponent(tag)) : null
    const status: AppUpdateStatus = {
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion ? isNewerVersion(latestVersion, currentVersion) : false,
      releaseUrl,
      checkedAt: now,
      error: null,
    }
    cache = { key, at: now, status }
    return status
  } catch (e) {
    const status = errorStatus(currentVersion, now, e)
    cache = { key, at: now, status }
    return status
  }
}

export function clearAppUpdateCache() {
  cache = null
}
