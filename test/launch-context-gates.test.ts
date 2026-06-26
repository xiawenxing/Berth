import { describe, it, expect } from 'vitest'
import { parseContextGates, validateAddDirs } from '../src/server/pty-ws'

describe('parseContextGates', () => {
  const gates = (qs: string) => parseContextGates(new URLSearchParams(qs))
  it('defaults both gates to true when absent (back-compat)', () => {
    expect(gates('')).toEqual({ project: true, task: true })
  })
  it('reads 0 as off, anything else as on', () => {
    expect(gates('ctxProject=0&ctxTask=1')).toEqual({ project: false, task: true })
    expect(gates('ctxProject=1&ctxTask=0')).toEqual({ project: true, task: false })
  })
})

describe('validateAddDirs', () => {
  it('keeps only dirs present in the enabled-paths allowlist', () => {
    expect(validateAddDirs(['/a', '/evil', '/b'], ['/a', '/b', '/c'])).toEqual(['/a', '/b'])
  })
  it('returns empty when nothing matches', () => {
    expect(validateAddDirs(['/x'], ['/a'])).toEqual([])
    expect(validateAddDirs([], ['/a'])).toEqual([])
  })
})
