import { describe, it, expect } from 'vitest'
import { isLocalHref } from './local-links'

describe('isLocalHref', () => {
  it('treats file://, absolute, ~ and custom-scheme links as local', () => {
    expect(isLocalHref('file:///Users/me/x.md')).toBe(true)
    expect(isLocalHref('/Users/me/x.md')).toBe(true)
    expect(isLocalHref('~/notes/x.md')).toBe(true)
    expect(isLocalHref('obsidian://open?file=x')).toBe(true)
    expect(isLocalHref('vscode://file/Users/me/x')).toBe(true)
  })
  it('treats http(s), mailto, tel, anchors and protocol-relative as non-local', () => {
    expect(isLocalHref('https://example.com')).toBe(false)
    expect(isLocalHref('http://127.0.0.1:7777/app/')).toBe(false)
    expect(isLocalHref('mailto:a@b.com')).toBe(false)
    expect(isLocalHref('tel:+123')).toBe(false)
    expect(isLocalHref('#section')).toBe(false)
    expect(isLocalHref('//cdn.example.com/x')).toBe(false)
    expect(isLocalHref('')).toBe(false)
  })
  it('handles edge cases: whitespace, uppercase file://, query/hash on a local path', () => {
    expect(isLocalHref('  /Users/me/x.md  ')).toBe(true)   // trimmed
    expect(isLocalHref('FILE:///Users/me/x.md')).toBe(true) // case-insensitive scheme
    expect(isLocalHref('/Users/me/x.md#heading')).toBe(true)
    expect(isLocalHref('   ')).toBe(false)                  // whitespace-only
  })
})
