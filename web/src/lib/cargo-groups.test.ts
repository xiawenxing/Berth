import { describe, expect, it } from 'vitest'
import { emptyCargoGroups, normCwd } from './cargo-groups'

describe('normCwd', () => {
  it('strips trailing slashes', () => {
    expect(normCwd('/a/b/')).toBe('/a/b')
    expect(normCwd('/a/b///')).toBe('/a/b')
    expect(normCwd('/a/b')).toBe('/a/b')
  })
})

describe('emptyCargoGroups', () => {
  const meta = (cwd: string, enabled = true) => ({ cwd, enabled })

  it('surfaces a registered dir that has no session', () => {
    const groups = emptyCargoGroups([meta('/code/foo')], [])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: '/code/foo', rawCwd: '/code/foo', kind: 'cwd', tag: '装载目录', sessions: [] })
  })

  it('omits a registered dir that already has a session-bearing group', () => {
    expect(emptyCargoGroups([meta('/code/foo')], ['/code/foo'])).toHaveLength(0)
  })

  it('is trailing-slash tolerant against session cwds', () => {
    expect(emptyCargoGroups([meta('/code/foo/')], ['/code/foo'])).toHaveLength(0)
    expect(emptyCargoGroups([meta('/code/foo')], ['/code/foo/'])).toHaveLength(0)
  })

  it('excludes the masked workspace dir', () => {
    expect(emptyCargoGroups([meta('/ws')], [], '/ws/')).toHaveLength(0)
  })

  it('shows registered dirs regardless of enabled flag', () => {
    const groups = emptyCargoGroups([meta('/code/off', false)], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].rawCwd).toBe('/code/off')
  })

  it('de-dups duplicate registrations (trailing-slash variants)', () => {
    expect(emptyCargoGroups([meta('/code/foo'), meta('/code/foo/')], [])).toHaveLength(1)
  })

  it('keeps multiple distinct empty dirs', () => {
    const groups = emptyCargoGroups([meta('/a'), meta('/b')], ['/c'])
    expect(groups.map((g) => g.rawCwd)).toEqual(['/a', '/b'])
  })

  it('handles undefined pathsMeta', () => {
    expect(emptyCargoGroups(undefined, [])).toEqual([])
  })
})
