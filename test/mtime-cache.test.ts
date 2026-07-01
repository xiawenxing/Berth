import { describe, it, expect } from 'vitest'
import { createMtimeCache } from '../src/adapters/mtime-cache'

/** A fake stat backed by a mutable mtime map, so tests don't touch the filesystem. */
function fakeStat(mtimes: Map<string, number>) {
  return (p: string) => {
    if (!mtimes.has(p)) throw new Error('ENOENT')
    return { mtimeMs: mtimes.get(p)! }
  }
}

describe('createMtimeCache', () => {
  it('computes once, then serves cached value while mtime is unchanged', () => {
    const mtimes = new Map([['a', 100]])
    const cache = createMtimeCache<string>(fakeStat(mtimes))
    let reads = 0
    const read = () => { reads++; return `parsed:${reads}` }

    expect(cache.resolve('a', read)).toBe('parsed:1')
    expect(cache.resolve('a', read)).toBe('parsed:1')   // cached — no recompute
    expect(cache.resolve('a', read)).toBe('parsed:1')
    expect(reads).toBe(1)
  })

  it('recomputes when the file mtime changes', () => {
    const mtimes = new Map([['a', 100]])
    const cache = createMtimeCache<string>(fakeStat(mtimes))
    let reads = 0
    const read = () => { reads++; return `parsed:${reads}` }

    expect(cache.resolve('a', read)).toBe('parsed:1')
    mtimes.set('a', 200)                                 // file changed (appended turn)
    expect(cache.resolve('a', read)).toBe('parsed:2')    // recomputed
    expect(reads).toBe(2)
  })

  it('keeps separate cache entries per path', () => {
    const mtimes = new Map([['a', 1], ['b', 1]])
    const cache = createMtimeCache<string>(fakeStat(mtimes))
    let reads = 0
    const read = () => { reads++; return `v${reads}` }

    expect(cache.resolve('a', read)).toBe('v1')
    expect(cache.resolve('b', read)).toBe('v2')
    expect(cache.resolve('a', read)).toBe('v1')          // still cached
    expect(reads).toBe(2)
  })

  it('prune drops entries no longer present so they recompute next time', () => {
    const mtimes = new Map([['a', 1]])
    const cache = createMtimeCache<string>(fakeStat(mtimes))
    let reads = 0
    const read = () => { reads++; return `v${reads}` }

    cache.resolve('a', read)            // reads=1
    cache.prune([])                     // 'a' no longer live → evicted
    cache.resolve('a', read)            // reads=2 (recomputed)
    expect(reads).toBe(2)
  })

  it('does not cache when the file is unstattable (always recomputes)', () => {
    const cache = createMtimeCache<string>(fakeStat(new Map()))   // every stat throws
    let reads = 0
    const read = () => { reads++; return `v${reads}` }

    expect(cache.resolve('gone', read)).toBe('v1')
    expect(cache.resolve('gone', read)).toBe('v2')
    expect(reads).toBe(2)
  })
})
