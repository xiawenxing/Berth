export interface CargoDir { cwd: string; loaded: boolean }

export interface CargoState {
  ctxProject: boolean
  ctxTask: boolean
  codeOn: boolean        // 代码上下文主开关
  dirs: CargoDir[]       // 已登记 enabled 目录，原序
  litCwd: string | null  // 点亮的启动目录；null = 默认启动目录
}

export interface CargoLaunch { cwd: string; addDirs: string[]; ctxProject: boolean; ctxTask: boolean }

/** 默认：上下文全开，所有已登记目录装载，点亮 sticky lastCwd（否则第一个）。ctxTask 仅任务启动为真。 */
export function initCargo(enabledPaths: string[], lastCwd: string | null, hasTask: boolean): CargoState {
  const litCwd = lastCwd && enabledPaths.includes(lastCwd) ? lastCwd : (enabledPaths[0] ?? null)
  return {
    ctxProject: true,
    ctxTask: hasTask,
    codeOn: true,
    dirs: enabledPaths.map((cwd) => ({ cwd, loaded: true })),
    litCwd,
  }
}

function firstLoadedCwd(dirs: CargoDir[]): string | null {
  return dirs.find((d) => d.loaded)?.cwd ?? null
}

/** Add a newly-registered directory to the current launch cargo. */
export function addDir(s: CargoState, cwd: string): CargoState {
  if (s.dirs.some((d) => d.cwd === cwd)) return s
  const hadLoaded = s.dirs.some((d) => d.loaded)
  return {
    ...s,
    dirs: [...s.dirs, { cwd, loaded: true }],
    litCwd: s.litCwd ?? (hadLoaded ? null : cwd),
  }
}

/** 勾选/取消装载某目录。取消点亮中的目录 → 由剩余装载目录接力；从无装载到首次勾选 → 自动点亮。 */
export function toggleDir(s: CargoState, cwd: string): CargoState {
  const hadLoaded = s.dirs.some((d) => d.loaded)
  const dirs = s.dirs.map((d) => (d.cwd === cwd ? { ...d, loaded: !d.loaded } : d))
  const target = dirs.find((d) => d.cwd === cwd)!
  let litCwd = s.litCwd
  if (!target.loaded && s.litCwd === cwd) litCwd = firstLoadedCwd(dirs)
  else if (target.loaded && s.litCwd === null && !hadLoaded) litCwd = cwd
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
