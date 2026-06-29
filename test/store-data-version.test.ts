import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'

describe('store.dataVersion', () => {
  it('returns a number and changes after an external connection writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-dv-'))
    const path = join(dir, 'berth.sqlite')
    const a = openStore(path)
    const v0 = a.dataVersion()
    expect(typeof v0).toBe('number')
    const b = openStore(path)                 // a SECOND connection (≈ another process)
    b.addEdge('todo-x', 'sess-y')             // any committed write via a different connection
    expect(a.dataVersion()).not.toBe(v0)      // connection a observes b's commit
    rmSync(dir, { recursive: true, force: true })
  })
})
