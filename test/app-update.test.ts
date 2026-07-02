import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clearAppUpdateCache, getAppUpdateStatus, isNewerVersion, normalizeVersion } from '../src/app-update'

beforeEach(() => clearAppUpdateCache())

describe('app update checks', () => {
  it('normalizes v-prefixed versions and compares semver-ish versions', () => {
    expect(normalizeVersion('v2.0.5')).toBe('2.0.5')
    expect(isNewerVersion('2.0.5', '2.0.4')).toBe(true)
    expect(isNewerVersion('2.1.0', '2.0.9')).toBe(true)
    expect(isNewerVersion('2.0.4', '2.0.4')).toBe(false)
    expect(isNewerVersion('2.0.3', '2.0.4')).toBe(false)
  })

  it('reports an available update from GitHub latest release metadata', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      url: 'https://github.com/xiawenxing/Berth/releases/tag/v2.0.5',
    } as Response))

    const status = await getAppUpdateStatus({
      currentVersion: '2.0.4',
      now: 1000,
      fetchImpl: fetchImpl as any,
    })

    expect(status.updateAvailable).toBe(true)
    expect(status.latestVersion).toBe('2.0.5')
    expect(status.releaseUrl).toContain('v2.0.5')
  })

  it('caches successful checks for the same current version', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      url: 'https://github.com/xiawenxing/Berth/releases/tag/v2.0.5',
    } as Response))

    await getAppUpdateStatus({ currentVersion: '2.0.4', now: 1000, fetchImpl: fetchImpl as any })
    await getAppUpdateStatus({ currentVersion: '2.0.4', now: 2000, fetchImpl: fetchImpl as any })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns a quiet non-update status when the network check fails', async () => {
    const status = await getAppUpdateStatus({
      currentVersion: '2.0.4',
      now: 1000,
      fetchImpl: vi.fn(async () => { throw new Error('offline') }) as any,
    })

    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBeNull()
    expect(status.error).toContain('offline')
  })
})
