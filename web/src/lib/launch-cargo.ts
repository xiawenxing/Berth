export interface CargoDir { cwd: string; loaded: boolean }

export interface CargoState {
  ctxProject: boolean
  ctxTask: boolean
  codeOn: boolean        // 代码上下文主开关
  dirs: CargoDir[]       // 已登记 enabled 目录，原序
  litCwd: string | null  // 点亮的启动目录；null = 默认启动目录
}

export interface CargoLaunch { cwd: string; addDirs: string[]; ctxProject: boolean; ctxTask: boolean }

/** 默认：上下文全开，所有已登记目录装载，但不自动指定启动 cwd。ctxTask 仅任务启动为真。 */
export function initCargo(enabledPaths: string[], lastCwd: string | null, hasTask: boolean): CargoState {
  return {
    ctxProject: true,
    ctxTask: hasTask,
    codeOn: true,
    dirs: enabledPaths.map((cwd) => ({ cwd, loaded: true })),
    litCwd: null,
  }
}

/** 勾选/取消装载某目录。取消点亮中的目录 → 回退默认；从无装载到首次勾选 → 自动点亮。 */
export function toggleDir(s: CargoState, cwd: string): CargoState {
  const dirs = s.dirs.map((d) => (d.cwd === cwd ? { ...d, loaded: !d.loaded } : d))
  const target = dirs.find((d) => d.cwd === cwd)!
  let litCwd = s.litCwd
  if (!target.loaded && s.litCwd === cwd) litCwd = null
  else if (target.loaded && s.litCwd === null) litCwd = cwd
  return { ...s, dirs, litCwd }
}

/** ⚓ 点亮：仅对已装载行有效；单选；再点同一行 → 清空回默认。 */
export function anchorDir(s: CargoState, cwd: string): CargoState {
  const d = s.dirs.find((x) => x.cwd === cwd)
  if (!d?.loaded) return s
  return { ...s, litCwd: s.litCwd === cwd ? null : cwd }
}

export function setCode(s: CargoState, on: boolean): CargoState {
  return { ...s, codeOn: on }
}

/** 推导起航 payload：代码上下文关 → 默认目录、无 add-dir；否则点亮的是 cwd，其余装载目录走 add-dir。 */
export function deriveLaunch(s: CargoState): CargoLaunch {
  if (!s.codeOn) return { cwd: '', addDirs: [], ctxProject: s.ctxProject, ctxTask: s.ctxTask }
  const loaded = s.dirs.filter((d) => d.loaded).map((d) => d.cwd)
  const cwd = s.litCwd ?? ''
  const addDirs = loaded.filter((c) => c !== cwd)
  return { cwd, addDirs, ctxProject: s.ctxProject, ctxTask: s.ctxTask }
}
