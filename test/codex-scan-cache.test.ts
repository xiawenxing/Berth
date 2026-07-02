import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCodexSessions } from '../src/adapters/codex'
import { createMtimeCache } from '../src/adapters/mtime-cache'
import type { PhysicalSession } from '../src/types'

let root: string
let rollout: string

function metaLine(cwd: string): string {
  return JSON.stringify({ payload: { id: 'sess-1', cwd, thread_name: 'T', timestamp: '2026-01-01T00:00:00Z' } })
}

// A fixed mtime makes "unchanged on disk" deterministic regardless of FS timestamp precision.
const FIXED = new Date('2026-03-03T03:03:03.000Z')

function writeRollout(cwd: string, mtime: Date = FIXED): void {
  writeFileSync(rollout, metaLine(cwd) + '\n' + JSON.stringify({ timestamp: '2026-01-01T00:01:00Z', type: 'message' }) + '\n')
  utimesSync(rollout, mtime, mtime)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'berth-codex-'))
  const dir = join(root, 'sessions', '2026', '01', '01')
  mkdirSync(dir, { recursive: true })
  rollout = join(dir, 'rollout-2026-01-01T00-00-00-sess-1.jsonl')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listCodexSessions mtime cache', () => {
  it('serves the cached parse while mtime is unchanged (does not re-read content)', () => {
    const cache = createMtimeCache<PhysicalSession | null>()
    writeRollout('/work/original', FIXED)

    expect(listCodexSessions(root, cache)[0].cwd).toBe('/work/original')

    // Content changed on disk, but mtime is held constant → must keep returning the cached value.
    writeRollout('/work/CHANGED', FIXED)
    expect(listCodexSessions(root, cache)[0].cwd).toBe('/work/original')
  })

  it('re-reads when the file mtime advances (appended turn)', () => {
    const cache = createMtimeCache<PhysicalSession | null>()
    writeRollout('/work/original', FIXED)
    expect(listCodexSessions(root, cache)[0].cwd).toBe('/work/original')

    writeRollout('/work/CHANGED', new Date('2026-03-03T04:04:04.000Z'))   // later mtime
    expect(listCodexSessions(root, cache)[0].cwd).toBe('/work/CHANGED')
  })

  it('still lists every globbed session (parity with a fresh, empty cache)', () => {
    writeRollout('/work/a')
    const a = listCodexSessions(root, createMtimeCache<PhysicalSession | null>())
    const b = listCodexSessions(root, createMtimeCache<PhysicalSession | null>())
    expect(a).toEqual(b)
    expect(a).toHaveLength(1)
    expect(a[0].physicalId).toBe('sess-1')
  })
})
