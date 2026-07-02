import { describe, it, expect } from 'vitest'
import { hasUtf8Locale, withUtf8Locale } from '../src/pty/locale'

describe('hasUtf8Locale', () => {
  it('detects UTF-8 via LC_ALL, LC_CTYPE, or LANG (case/format-insensitive)', () => {
    expect(hasUtf8Locale({ LC_ALL: 'en_US.UTF-8' })).toBe(true)
    expect(hasUtf8Locale({ LC_CTYPE: 'C.utf8' })).toBe(true)
    expect(hasUtf8Locale({ LANG: 'zh_CN.UTF-8' })).toBe(true)
  })
  it('is false for the GUI-launch / C-locale case (nothing UTF-8)', () => {
    expect(hasUtf8Locale({})).toBe(false)
    expect(hasUtf8Locale({ LANG: '', LC_CTYPE: 'C' })).toBe(false)
    expect(hasUtf8Locale({ LANG: 'en_US.ISO8859-1' })).toBe(false)
  })
})

describe('withUtf8Locale', () => {
  it('injects a UTF-8 LC_CTYPE when the env lacks any UTF-8 locale, preserving other vars', () => {
    const out = withUtf8Locale({ PATH: '/usr/bin' })
    expect(hasUtf8Locale(out)).toBe(true)
    expect(out.LC_CTYPE).toMatch(/utf-?8/i)
    expect(out.PATH).toBe('/usr/bin')
  })
  it('overrides an explicit C locale (the Mac-Roman fallback that corrupts the clipboard flavor)', () => {
    expect(withUtf8Locale({ LC_CTYPE: 'C' }).LC_CTYPE).toMatch(/utf-?8/i)
  })
  it('leaves the env reference untouched when a UTF-8 locale is already present', () => {
    const env = { LANG: 'zh_CN.UTF-8', PATH: '/bin' }
    expect(withUtf8Locale(env)).toBe(env)
  })
  it('does not mutate the input object when it injects', () => {
    const env: NodeJS.ProcessEnv = { LANG: '' }
    const out = withUtf8Locale(env)
    expect(env.LC_CTYPE).toBeUndefined()
    expect(out).not.toBe(env)
  })
})
