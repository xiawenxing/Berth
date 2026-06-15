import { describe, it, expect } from 'vitest'
import { getAdapter } from '../src/data/sync/registry'

describe('adapter registry', () => {
  it('returns the meego stub by kind', () => {
    expect(getAdapter('meego').kind).toBe('meego')
  })

  it('meego stub rejects pullTasks as not implemented', async () => {
    const a = getAdapter('meego')
    await expect(a.pullTasks({ id: 'm', kind: 'meego', label: null, config: {}, pullMode: 'manual', pushMode: 'manual', enabled: true }, { docsRoot: '/x' }))
      .rejects.toThrow(/not implemented/i)
  })

  it('throws on unknown kind', () => {
    expect(() => getAdapter('nope')).toThrow(/unknown/i)
  })
})
