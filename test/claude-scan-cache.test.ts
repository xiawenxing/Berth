import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listClaudeSessions } from '../src/adapters/claude'
import { createMtimeCache } from '../src/adapters/mtime-cache'
import type { PhysicalSession } from '../src/types'

let root: string
let file: string

// A fixed mtime makes "unchanged on disk" deterministic regardless of FS timestamp precision.
const FIXED = new Date('2026-03-03T03:03:03.000Z')

function write(cwd: string, mtime: Date = FIXED): void {
  writeFileSync(file, JSON.stringify({ type: 'user', cwd, timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'hi' } }) + '\n')
  utimesSync(file, mtime, mtime)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'berth-claude-'))
  const dir = join(root, 'project-a')
  mkdirSync(dir, { recursive: true })
  file = join(dir, '11111111-2222-3333-4444-555555555555.jsonl')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listClaudeSessions mtime cache', () => {
  it('serves the cached parse while mtime is unchanged', () => {
    const cache = createMtimeCache<PhysicalSession | null>()
    write('/work/original', FIXED)
    expect(listClaudeSessions(root, cache)[0].cwd).toBe('/work/original')

    write('/work/CHANGED', FIXED)   // content changed, mtime held → cache hit
    expect(listClaudeSessions(root, cache)[0].cwd).toBe('/work/original')
  })

  it('re-reads after mtime advances', () => {
    const cache = createMtimeCache<PhysicalSession | null>()
    write('/work/original', FIXED)
    expect(listClaudeSessions(root, cache)[0].cwd).toBe('/work/original')

    write('/work/CHANGED', new Date('2026-03-03T04:04:04.000Z'))   // later mtime
    expect(listClaudeSessions(root, cache)[0].cwd).toBe('/work/CHANGED')
  })
})
