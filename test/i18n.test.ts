import { describe, it, expect, vi } from 'vitest'
import { normalizeLocale, getLocale, DEFAULT_LOCALE } from '../src/i18n'

describe('locale resolution', () => {
  it('normalizes known locales and falls back to the default otherwise', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE)
  })

  it('reads the locale from app settings', () => {
    const store = { getSetting: vi.fn((k: string) => (k === 'locale' ? 'en' : null)) }
    expect(getLocale(store)).toBe('en')
  })

  it('defaults when the locale setting is unset', () => {
    const store = { getSetting: () => null }
    expect(getLocale(store)).toBe(DEFAULT_LOCALE)
  })
})
