import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCliArgs } from '../src/cli'
import { resolvePublicDir } from '../src/server/public-dir'

describe('parseCliArgs', () => {
  it('defaults: start command, no port, browser opens', () => {
    expect(parseCliArgs([])).toEqual({ command: 'start', port: undefined, host: undefined, open: true })
    expect(parseCliArgs(['start'])).toEqual({ command: 'start', port: undefined, host: undefined, open: true })
  })

  it('parses --port and --host', () => {
    expect(parseCliArgs(['start', '--port', '8080', '--host', '0.0.0.0']))
      .toEqual({ command: 'start', port: 8080, host: '0.0.0.0', open: true })
  })

  it('--no-open disables the browser launch', () => {
    expect(parseCliArgs(['start', '--no-open']).open).toBe(false)
  })

  it('recognizes help and version', () => {
    expect(parseCliArgs(['--help']).command).toBe('help')
    expect(parseCliArgs(['-h']).command).toBe('help')
    expect(parseCliArgs(['--version']).command).toBe('version')
  })

  it('rejects a non-numeric port', () => {
    expect(() => parseCliArgs(['start', '--port', 'abc'])).toThrow(/port/i)
  })
})

describe('resolvePublicDir', () => {
  it('finds the public dir by walking up from a nested start dir (dev + compiled layouts)', () => {
    const root = mkdtempSync(join(tmpdir(), 'berth-pub-'))
    mkdirSync(join(root, 'public'))
    writeFileSync(join(root, 'public', 'index.html'), '<html></html>')
    mkdirSync(join(root, 'dist', 'server'), { recursive: true })
    // from dist/server (compiled) and from src/server-equivalent depth, it should find root/public
    expect(resolvePublicDir(join(root, 'dist', 'server'))).toBe(join(root, 'public'))
  })

  it('throws a clear error when no public/index.html exists above', () => {
    const root = mkdtempSync(join(tmpdir(), 'berth-nopub-'))
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    expect(() => resolvePublicDir(join(root, 'a', 'b'))).toThrow(/public/i)
  })
})
