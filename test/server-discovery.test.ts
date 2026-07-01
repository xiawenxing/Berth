import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeServerFile, readServerFile, removeServerFile, serverFilePath } from '../src/server-discovery'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-disc-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('server-discovery', () => {
  it('writes then reads back the address under BERTH_HOME', () => {
    writeServerFile({ port: 7777, host: '127.0.0.1' })
    expect(existsSync(serverFilePath())).toBe(true)
    const r = readServerFile()!
    expect(r.port).toBe(7777); expect(r.host).toBe('127.0.0.1'); expect(r.pid).toBe(process.pid)
  })
  it('returns null when the recorded pid is dead', () => {
    writeServerFile({ port: 7777, host: '127.0.0.1', pid: 2147483646 })
    expect(readServerFile()).toBeNull()
  })
  it('returns null when no file exists', () => { expect(readServerFile()).toBeNull() })
  it('removeServerFile is idempotent', () => { removeServerFile(); writeServerFile({ port: 1, host: 'h' }); removeServerFile(); expect(existsSync(serverFilePath())).toBe(false) })
})
