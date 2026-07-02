import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveOpenTarget, openCommand, isAllowedOrigin } from '../src/server/open-local'

describe('resolveOpenTarget', () => {
  it('decodes a file:// URL to a filesystem path', () => {
    expect(resolveOpenTarget('file:///Users/a%20b/c.md')).toEqual({ kind: 'file', value: '/Users/a b/c.md' })
  })
  it('expands a ~ home path', () => {
    expect(resolveOpenTarget('~/notes/x.md')).toEqual({ kind: 'file', value: join(homedir(), 'notes/x.md') })
  })
  it('keeps a bare absolute path', () => {
    expect(resolveOpenTarget('/Users/me/x.md')).toEqual({ kind: 'file', value: '/Users/me/x.md' })
  })
  it('passes a custom scheme through untouched', () => {
    expect(resolveOpenTarget('obsidian://open?vault=v&file=n')).toEqual({ kind: 'scheme', value: 'obsidian://open?vault=v&file=n' })
  })
  it('throws on an unsupported target (relative / http)', () => {
    expect(() => resolveOpenTarget('relative/path')).toThrow()
    expect(() => resolveOpenTarget('https://example.com')).toThrow()
  })
  it('trims surrounding whitespace before classifying', () => {
    expect(resolveOpenTarget('  /Users/me/x.md  ')).toEqual({ kind: 'file', value: '/Users/me/x.md' })
  })
  it('matches file:// case-insensitively (decodes to a path)', () => {
    expect(resolveOpenTarget('FILE:///Users/me/x.md')).toEqual({ kind: 'file', value: '/Users/me/x.md' })
  })
})

describe('openCommand', () => {
  it('uses `open` on macOS', () => {
    expect(openCommand('darwin', '/x/y')).toEqual({ bin: 'open', args: ['/x/y'] })
  })
  it('uses `xdg-open` on linux', () => {
    expect(openCommand('linux', '/x/y')).toEqual({ bin: 'xdg-open', args: ['/x/y'] })
  })
  it('uses `start` via cmd on windows', () => {
    expect(openCommand('win32', 'C:\\x')).toEqual({ bin: 'cmd', args: ['/c', 'start', '', 'C:\\x'] })
  })
})

describe('isAllowedOrigin', () => {
  it('allows a missing origin (non-browser client)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
  })
  it('allows loopback origins on any port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:7777')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
  })
  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false)
  })
  it('rejects an unparseable origin', () => {
    expect(isAllowedOrigin('not a url')).toBe(false)
  })
})
