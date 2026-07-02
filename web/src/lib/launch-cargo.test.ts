import { describe, expect, it } from 'vitest'
import { addDir, anchorDir, deriveLaunch, initCargo, toggleDir, type CargoState } from './launch-cargo'

function cargo(): CargoState {
  return initCargo(['/repo/a', '/repo/b', '/repo/c'], null, true)
}

describe('launch cargo', () => {
  it('initially picks the sticky cwd when it is enabled', () => {
    expect(initCargo(['/repo/a', '/repo/b'], '/repo/b', true).litCwd).toBe('/repo/b')
  })

  it('initially falls back to the first enabled cwd', () => {
    expect(initCargo(['/repo/a', '/repo/b'], '/repo/missing', true).litCwd).toBe('/repo/a')
  })

  it('moves the launch cwd to another loaded dir when the current one is unloaded', () => {
    const next = toggleDir(cargo(), '/repo/a')

    expect(next.litCwd).toBe('/repo/b')
    expect(deriveLaunch(next)).toMatchObject({
      cwd: '/repo/b',
      addDirs: ['/repo/c'],
    })
  })

  it('clears the launch cwd when the last loaded dir is unloaded', () => {
    let state = cargo()
    state = toggleDir(state, '/repo/b')
    state = toggleDir(state, '/repo/c')
    state = toggleDir(state, '/repo/a')

    expect(state.litCwd).toBeNull()
    expect(deriveLaunch(state)).toMatchObject({ cwd: '', addDirs: [] })
  })

  it('keeps a manually cleared launch cwd cleared while dirs remain loaded', () => {
    const cleared = anchorDir(cargo(), '/repo/a')
    const withExtra = addDir(cleared, '/repo/d')

    expect(cleared.litCwd).toBeNull()
    expect(withExtra.litCwd).toBeNull()
    expect(deriveLaunch(withExtra).cwd).toBe('')
  })

  it('picks a launch cwd when adding the first loaded dir', () => {
    const empty = initCargo([], null, false)
    const next = addDir(empty, '/repo/a')

    expect(next.litCwd).toBe('/repo/a')
    expect(deriveLaunch(next).cwd).toBe('/repo/a')
  })
})
