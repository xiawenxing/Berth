import { describe, it, expect } from 'vitest'
import { addDir, initCargo, toggleDir, anchorDir, setCode, deriveLaunch } from '../web/src/lib/launch-cargo'

const paths = ['/a', '/b', '/c']

describe('launch-cargo', () => {
  it('inits all dirs loaded, lits sticky lastCwd, task gate follows hasTask', () => {
    const s = initCargo(paths, '/b', true)
    expect(s.dirs.every((d) => d.loaded)).toBe(true)
    expect(s.litCwd).toBe('/b')
    expect(s.ctxProject).toBe(true)
    expect(s.ctxTask).toBe(true)
    expect(s.codeOn).toBe(true)
  })

  it('lits first dir when lastCwd is not an enabled path; ctxTask off when no task', () => {
    const s = initCargo(paths, '/zzz', false)
    expect(s.litCwd).toBe('/a')
    expect(s.ctxTask).toBe(false)
  })

  it('derive: lit dir is cwd, other loaded dirs are addDirs', () => {
    const s = initCargo(paths, '/a', true)
    expect(deriveLaunch(s)).toEqual({ cwd: '/a', addDirs: ['/b', '/c'], ctxProject: true, ctxTask: true })
  })

  it('unchecking the lit dir lets another loaded dir become cwd', () => {
    let s = initCargo(paths, '/a', true)
    s = toggleDir(s, '/a')
    expect(s.litCwd).toBe('/b')
    expect(deriveLaunch(s).cwd).toBe('/b')
    expect(deriveLaunch(s).addDirs).toEqual(['/c'])
  })

  it('manual anchor clear keeps cwd default while loaded dirs remain', () => {
    let s = initCargo(paths, '/a', true)
    s = anchorDir(s, '/a')
    expect(s.litCwd).toBeNull()
    s = addDir(s, '/d')
    expect(s.litCwd).toBeNull()
    expect(deriveLaunch(s).cwd).toBe('')
  })

  it('checking the first dir from empty auto-lits it', () => {
    let s = initCargo(paths, '/a', true)
    s = toggleDir(s, '/a'); s = toggleDir(s, '/b'); s = toggleDir(s, '/c') // all off
    expect(s.litCwd).toBeNull()
    s = toggleDir(s, '/b') // first re-check auto-lits
    expect(s.litCwd).toBe('/b')
  })

  it('anchor toggles single-select among checked rows; re-anchor clears to 默认', () => {
    let s = initCargo(paths, '/a', true)
    s = anchorDir(s, '/c')
    expect(s.litCwd).toBe('/c')
    s = anchorDir(s, '/c')
    expect(s.litCwd).toBeNull()
  })

  it('anchor on an unchecked row is a no-op', () => {
    let s = initCargo(paths, '/a', true)
    s = toggleDir(s, '/b') // uncheck /b
    s = anchorDir(s, '/b')
    expect(s.litCwd).toBe('/a')
  })

  it('code context off → cwd="" and no addDirs', () => {
    let s = initCargo(paths, '/a', true)
    s = setCode(s, false)
    expect(deriveLaunch(s)).toEqual({ cwd: '', addDirs: [], ctxProject: true, ctxTask: true })
  })
})
