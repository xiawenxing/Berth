# 起航货舱控件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 2.0 起航对话框恢复"货舱"控件——三级上下文开关（项目/任务/代码）、多目录 `--add-dir` 装载、可点亮/可清除的启动目录——全程渐进披露，默认折叠零打扰。

**Architecture:** 后端给 `buildManifest` 加 include 门控、给 `/pty?new=1` 加 `addDirs`/`ctxProject`/`ctxTask` 参数并在 `handleFresh` 里校验+组装；前端把启动目录与装载目录合并成一个统一目录列表（勾选=装载，⚓点亮=cwd），状态逻辑抽成可单测的纯 helper，UI 折叠进一个安静的"货舱"块。docsRoot 对用户隐藏、由服务端自动挂载。

**Tech Stack:** Node + TypeScript（`src/`）、Vitest（`test/`）、React + Vite + Tailwind（`web/`）。

**Spec:** `docs/superpowers/specs/2026-06-22-launch-cargo-controls-design.md`
**Mockup:** `docs/superpowers/mockups/2026-06-22-launch-cargo-v2.html`
**Branch:** 在 `release/berth-2.0-ia` 上推进（单线任务，无需 worktree）。

---

## File Structure

- **Modify** `src/agent/manifest.ts` — `ManifestInput` 加 `include?: { project?; task? }`；`buildManifest` 按门控拼接段落。
- **Modify** `src/server/pty-ws.ts` — 新增并导出纯 helper `parseContextGates` / `validateAddDirs`；`handleFresh` 解析 `addDirs`+门控、校验、组装 addDirs、按 `anyCtx` 决定是否注入。
- **Create** `web/src/lib/launch-cargo.ts` — 货舱状态 reducer + `deriveLaunch`（纯函数，单测）。
- **Modify** `web/src/components/Terminal.tsx` — `LaunchSpec` 加字段、拼 query。
- **Modify** `web/src/components/LaunchDialog.tsx` — 用 helper 重写"启动目录"段为折叠"货舱"块。
- **Create** `test/launch-cargo.test.ts` — helper 单测。
- **Modify** `test/manifest.test.ts` — 门控用例。
- **Create** `test/launch-context-gates.test.ts` — `parseContextGates`/`validateAddDirs` 单测。

---

## Task 1: manifest include 门控（后端纯函数）

**Files:**
- Modify: `src/agent/manifest.ts:8-35`（类型）、`50-136`（buildManifest）
- Test: `test/manifest.test.ts`

- [ ] **Step 1: 写失败测试** — 追加到 `test/manifest.test.ts` 末尾：

```ts
it('include.task=false drops the task section but keeps project scope', () => {
  const { text } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    include: { project: true, task: false },
    todo: { id: 'u1', title: '秘密任务标题', status: '进行中', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'projects/x.md', progress: null, updatedAt: 1, syncedAt: 0, deleted: false },
  })
  expect(text).not.toContain('秘密任务标题')
  expect(text).toContain('Berth project scope')
})

it('include.project=false drops project scope but keeps the task section', () => {
  const { text } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    include: { project: false, task: true },
    todo: { id: 'u1', title: '可见任务标题', status: '进行中', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'projects/x.md', progress: null, updatedAt: 1, syncedAt: 0, deleted: false },
  })
  expect(text).toContain('可见任务标题')
  expect(text).not.toContain('Berth project scope')
})

it('defaults to both sections when include is omitted (back-compat)', () => {
  const { text } = buildManifest({
    kind: 'task', projectName: 'Berth', docsRoot: DOCS_ROOT,
    todo: { id: 'u1', title: '默认标题', status: '进行中', priority: 'P1', projectId: 'p1', project: 'Berth',
            detailDoc: 'projects/x.md', progress: null, updatedAt: 1, syncedAt: 0, deleted: false },
  })
  expect(text).toContain('默认标题')
  expect(text).toContain('Berth project scope')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/manifest.test.ts`
Expected: 新 3 个用例 FAIL（`include` 还没接线，task 段总是出现）。

- [ ] **Step 3: 给类型加 include 字段** — 在 `src/agent/manifest.ts` 的 `TaskManifestInput`（8-17）与 `ProjectManifestInput`（19-28）各加一行（放在 `compactRules?` 附近）：

```ts
  include?: { project?: boolean; task?: boolean }
```

- [ ] **Step 4: 门控 buildManifest** — 在 `buildManifest` 里 `const lines: string[] = []` 之后（约 55 行）加：

```ts
  const incl = { project: input.include?.project ?? true, task: input.include?.task ?? true }
```

把 task 段（`if (input.kind === 'task') { ... } else { ... }`，61-99）改成按 `incl` 门控：

```ts
  if (input.kind === 'task') {
    if (incl.task) {
      const { todo, projectName } = input
      lines.push(m.sectionTask)
      lines.push(`${m.labelTitle}${todo.title}`)
      lines.push(`${m.labelStatus}${todo.status ?? '—'}`)
      lines.push(`${m.labelPriority}${todo.priority ?? '—'}`)
      lines.push(`${m.labelProject}${projectName}`)
      if (input.projectId) lines.push(`${m.labelProjectId}${input.projectId}`)
      if (todo.detailDoc) {
        const detailPath = detailRefToPath(todo.detailDoc, docsRoot)
        if (detailPath) lines.push(`${m.labelDetailDoc}${detailPath}`)
      }
    }
  } else {
    if (incl.project) {
      const { projectName, projectTodos } = input
      lines.push(m.projectHeading(projectName))
      if (input.projectId) lines.push(`${m.labelProjectId}${input.projectId}`)
      lines.push('')
      lines.push(m.pendingDetailDocs)
      for (const todo of projectTodos) {
        const detailPath = todo.detailDoc ? detailRefToPath(todo.detailDoc, docsRoot) : null
        lines.push(`- ${todo.title}: ${detailPath ?? m.noDetailDoc}`)
      }
    }
  }
```

把"Berth project scope"块（101-105）的条件加上 `incl.project`：

```ts
  if (incl.project && input.projectName && input.projectName !== '—') {
    lines.push('')
    lines.push('## Berth project scope')
    for (const r of m.projectScopeRules(input.projectName, input.projectId)) lines.push(`- ${r}`)
  }
```

（其余——框架行、维护尾块、预算截断、`addDirs:[docsRoot]`——保持不变。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/manifest.test.ts`
Expected: 全部 PASS（含原有用例，未传 include 时行为不变）。

- [ ] **Step 6: 提交**

```bash
git add src/agent/manifest.ts test/manifest.test.ts
git commit -m "feat(manifest): gate project/task sections via include flags"
```

---

## Task 2: 后端纯 helper — 上下文门控解析 + addDirs 校验

**Files:**
- Modify: `src/server/pty-ws.ts`（在 `enrichManifestForContext` 附近，约 230 行后，导出两个 helper）
- Test: `test/launch-context-gates.test.ts`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `test/launch-context-gates.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/launch-context-gates.test.ts`
Expected: FAIL（`parseContextGates`/`validateAddDirs` 未导出）。

- [ ] **Step 3: 实现 helper** — 在 `src/server/pty-ws.ts` 的 `enrichManifestForContext`（226-230）之后插入：

```ts
/** Per-launch context gates. Absent param = on, so old clients keep the always-on behavior. */
export function parseContextGates(p: URLSearchParams): { project: boolean; task: boolean } {
  const on = (k: string) => p.get(k) !== '0'
  return { project: on('ctxProject'), task: on('ctxTask') }
}

/** Drop any requested --add-dir that isn't a currently-enabled registered path (anti-arbitrary-mount). */
export function validateAddDirs(requested: string[], enabledPaths: string[]): string[] {
  const allow = new Set(enabledPaths)
  return requested.filter((d) => allow.has(d))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/launch-context-gates.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/server/pty-ws.ts test/launch-context-gates.test.ts
git commit -m "feat(pty-ws): add context-gate + add-dir validation helpers"
```

---

## Task 3: 在 handleFresh 接线门控与 addDirs

**Files:**
- Modify: `src/server/pty-ws.ts:274-455`（`handleFresh`）

无新单测（`handleFresh` 是 ws 驱动的大函数）；逻辑核心已被 Task 1/2 的纯函数覆盖。本任务靠 `npx tsc --noEmit` + 既有 `test/pty-ws.new.test.ts` 回归 + Task 7 手测兜底。

- [ ] **Step 1: 解析门控与 addDirs** — 在 `handleFresh` 顶部读 query 处（280 行 `explicitPrompt` 之后）加：

```ts
  const gates = parseContextGates(url.searchParams)
  const requestedAddDirs = url.searchParams.getAll('addDirs')
```

- [ ] **Step 2: 校验 addDirs against 已登记 enabled 目录** — 在拿到 `store`（295 行）之后加：

```ts
  const enabledPaths = projectId
    ? (store.allProjectPaths().get(projectId)?.meta.filter((m) => m.enabled).map((m) => m.cwd) ?? [])
    : []
  const userAddDirs = validateAddDirs(requestedAddDirs, enabledPaths)
  const anyCtx = gates.project || gates.task
```

- [ ] **Step 3: 按 anyCtx 门控注入构建** — 把现有"Context maintenance"块（约 341-378，从 `let contextAbs` 到写 `injectFilePath` 为止）整体包进 `if (anyCtx)`，并把 manifest 构建处传入 include 门控。替换为：

```ts
  let contextAbs: string | null = null
  let injectFile: string | undefined
  let ctxAddDirs: string[] = []
  const ctxCfg = getContextConfig(store)
  if (anyCtx) {
    let ctxInjection: ContextInjection | null = null
    if (ctxCfg.protocolEnabled) {
      try {
        const ds = getDocStore(store)
        seedDefaultProtocol(ds, locale)
        const pName = plan.manifestInput.projectName
        const proto = resolveProtocol(ds, locale, pName)
        let ensuredAbs: string | null = null
        if (todoKey && launchedTodo) {
          const ensured = ensureContextDoc(ds, 'task', launchedTodo.id, { title: launchedTodo.title, projectName: launchedTodo.project, locale })
          ensuredAbs = ensured.abs
          if (ensured.created && !launchedTodo.detailDoc) {
            store.updateTaskFields(launchedTodo.id, { detailDoc: ensured.ref }, Date.now())
            launchedTodo.detailDoc = ensured.ref
          }
        } else if (projectId && pName && pName !== '—') {
          const ensured = ensureContextDoc(ds, 'project', pName, { title: pName, projectName: pName, locale })
          ensuredAbs = ensured.abs
        }
        contextAbs = ensuredAbs
        ctxInjection = { compactRules: proto.compactRules, protocolPath: proto.protocolPath, contextDocPath: ensuredAbs }
      } catch (e: any) {
        try { ws.send(`\r\n[berth] context init skipped: ${e?.message ?? e}\r\n`) } catch {}
      }
    }
    const enriched = { ...enrichManifestForContext(plan.manifestInput, ctxInjection), include: { project: gates.project, task: gates.task } }
    const { text, addDirs } = buildManifest(enriched, locale)
    mkdirSync(INJECT_DIR, { recursive: true })
    const injectFilePath = join(INJECT_DIR, `${plan.intent.id}.txt`)
    writeFileSync(injectFilePath, text)
    injectFile = injectFilePath
    ctxAddDirs = addDirs   // [docsRoot] — bound to "any context on"; hidden from the user
  }
  const finalAddDirs = [...userAddDirs, ...ctxAddDirs]
```

- [ ] **Step 4: 删除旧的重复构建行** — 原 373-384 行的旧 `enrichManifestForContext`/`buildManifest`/`writeFileSync`/`const injectFile = injectFilePath` 已被 Step 3 取代，删掉，避免重复声明。

- [ ] **Step 5: 把 finalAddDirs 传给 spawn** — 改 `launchFresh` 调用（414-423）里的 `addDirs`：

```ts
    addDirs: finalAddDirs,
```

（`injectFile` 现在可能是 `undefined`——`freshArgv` 已对此安全：claude 省略 `--append-system-prompt-file`，codex/coco 不设 `BERTH_CONTEXT_FILE` hook。）

- [ ] **Step 6: 类型检查 + 回归**

Run: `npx tsc --noEmit && npx vitest run test/pty-ws.new.test.ts test/manifest.test.ts test/launch.test.ts`
Expected: tsc 0 错；测试全绿。

- [ ] **Step 7: 提交**

```bash
git add src/server/pty-ws.ts
git commit -m "feat(pty-ws): gate context injection + pass validated project add-dirs on launch"
```

---

## Task 4: 前端货舱状态 helper（纯函数 + 单测）

**Files:**
- Create: `web/src/lib/launch-cargo.ts`
- Test: `test/launch-cargo.test.ts`

- [ ] **Step 1: 写失败测试** — 新建 `test/launch-cargo.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { initCargo, toggleDir, anchorDir, setCode, deriveLaunch } from '../web/src/lib/launch-cargo'

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

  it('unchecking the lit dir falls back to 默认 (cwd="")', () => {
    let s = initCargo(paths, '/a', true)
    s = toggleDir(s, '/a')
    expect(s.litCwd).toBeNull()
    expect(deriveLaunch(s).cwd).toBe('')
    expect(deriveLaunch(s).addDirs).toEqual(['/b', '/c'])
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/launch-cargo.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 helper** — 新建 `web/src/lib/launch-cargo.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/launch-cargo.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/launch-cargo.ts test/launch-cargo.test.ts
git commit -m "feat(web): launch-cargo state reducer + deriveLaunch helper"
```

---

## Task 5: LaunchSpec 字段 + Terminal query 拼接

**Files:**
- Modify: `web/src/components/Terminal.tsx:7-15`（`LaunchSpec`）、`139-143`（query）、`299`（deps）

- [ ] **Step 1: 给 LaunchSpec 加字段** — 在 `web/src/components/Terminal.tsx` 的 `LaunchSpec` 接口（7-15）`prompt?` 后加：

```ts
  addDirs?: string[]
  ctxProject?: boolean
  ctxTask?: boolean
```

- [ ] **Step 2: 拼进 query** — 在拼 query 处（`if (launch.todoKey) qs.set('todoKey', launch.todoKey)` 之后，约 142 行）加：

```ts
      for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
      if (launch.ctxProject === false) qs.set('ctxProject', '0')
      if (launch.ctxTask === false) qs.set('ctxTask', '0')
```

（只在「关」时写参数；缺省＝开，与后端 `parseContextGates` 默认一致，保持 URL 干净。）

- [ ] **Step 3: 补 effect 依赖** — 在 `Terminal` 的 launch effect 依赖数组（约 299 行）追加，避免 stale：

```ts
    launch?.addDirs, launch?.ctxProject, launch?.ctxTask,
```

- [ ] **Step 4: 类型检查**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: 0 错（字段为可选，无现有调用破坏）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/Terminal.tsx
git commit -m "feat(web): thread addDirs + context gates into the /pty launch query"
```

---

## Task 6: LaunchDialog 货舱块（折叠 UI + 接线）

**Files:**
- Modify: `web/src/components/LaunchDialog.tsx`（整体替换"启动目录"段 158-196，调整 state/imports/`sail`）

UI 形态严格对齐 mockup v2（`docs/superpowers/mockups/2026-06-22-launch-cargo-v2.html`）：默认折叠成安静灰条 + `高级 ⌄`；展开后＝上下文两开关 + 代码上下文主开关 + 统一目录列表（勾选＝装载，行尾 ⚓＝启动目录单选）+ 额外目录输入 + 实时 `启动目录：xxx`。

- [ ] **Step 1: 引入 helper 与状态** — 在 `LaunchDialog.tsx` 顶部 import 区加：

```ts
import { ChevronDown, Anchor as AnchorIcon, Plus } from 'lucide-react'
import { initCargo, toggleDir, anchorDir, setCode, deriveLaunch, type CargoState } from '@/lib/launch-cargo'
```

把现有 `const [pickedCwd, setPickedCwd] = useState<string | null>(null)`（25 行）替换为：

```ts
  const [cargo, setCargo] = useState<CargoState | null>(null)
  const [adjust, setAdjust] = useState(false)
  const [extraDir, setExtraDir] = useState('')
```

- [ ] **Step 2: 初始化 cargo（替换旧 autoPick/selectedCwd/useEffect 逻辑）** — 删除 30-35 行的 `enabledPaths`/`autoPick`/`selectedCwd`（保留 `enabledPaths` 定义，下面要用），并把 `useEffect`（37-45）里的 `setPickedCwd(null)` 改为初始化 cargo。最终相关代码：

```ts
  const enabledPaths = useMemo(() => (project?.pathsMeta ?? []).filter((p) => p.enabled).map((p) => p.cwd), [project])

  useEffect(() => {
    if (launch) {
      const hasTask = !!launch.taskTitle && launch.dest === 'task'
      setDest(launch.taskTitle ? launch.dest : 'free')
      setCli((prev) => (enabledAgents.some((a) => a.cli === prev) ? prev : enabledAgents[0]?.cli ?? 'claude'))
      setFreeText('')
      clearImages()
      setAdjust(false)
      setExtraDir('')
      setCargo(initCargo(enabledPaths, project?.lastCwd ?? null, hasTask))
    }
  }, [launch, enabledAgents, clearImages, enabledPaths, project])
```

注：`dest` 切到 `free` 时任务上下文应熄灭——在 `setDest` 的 Radio onClick 里同步（Step 4 处理）。

- [ ] **Step 3: 用 deriveLaunch 改写 sail()** — 把 `sail`（54-93）里 cwd/cwdLabel 推导改为读 cargo。替换 56-58 行：

```ts
    const d = cargo ? deriveLaunch(cargo) : { cwd: '', addDirs: [], ctxProject: true, ctxTask: dest === 'task' }
    const cwd = enabledPaths.length === 0 ? '' : d.cwd
    const cwdLabel = cwd ? shortCwd(cwd) : '项目默认目录'
    const pendingCwd = cwd || project?.workspaceCwd || ''
```

并在 `openDrawer(... launch: { ... })`（83-91）的 launch 对象里追加：

```ts
        addDirs: enabledPaths.length === 0 ? undefined : d.addDirs,
        ctxProject: d.ctxProject,
        ctxTask: dest === 'task' ? d.ctxTask : false,
```

- [ ] **Step 4: 替换"启动目录"段为货舱块** — 把 158-196 行整段（`{/* 启动目录 */}` 那个 `<div>`）替换为：

```tsx
        {/* 货舱 */}
        {cargo && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">货舱</div>
            <div className={cn('rounded-md border border-border', adjust && 'bg-background/30')}>
              <button
                onClick={() => setAdjust((v) => !v)}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px]', adjust && 'border-b border-border')}
              >
                <span className="flex-1 truncate text-muted-foreground">{cargoSummary(cargo, dest)}</span>
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                  高级 <ChevronDown size={13} className={cn('transition-transform', adjust && 'rotate-180')} />
                </span>
              </button>

              {adjust && (
                <div className="flex flex-col gap-3.5 p-3">
                  {/* 上下文注入 */}
                  <div>
                    <div className="mb-2 text-[11px] font-semibold text-muted-foreground">上下文注入</div>
                    <Check on={cargo.ctxProject} onClick={() => setCargo({ ...cargo, ctxProject: !cargo.ctxProject })}>项目上下文（Berth）</Check>
                    {dest === 'task' && (
                      <Check on={cargo.ctxTask} onClick={() => setCargo({ ...cargo, ctxTask: !cargo.ctxTask })} className="mt-2">任务上下文</Check>
                    )}
                  </div>

                  {/* 代码上下文 */}
                  <div className={cn(!cargo.codeOn && 'opacity-50')}>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                      代码上下文
                      <button
                        onClick={() => setCargo(setCode(cargo, !cargo.codeOn))}
                        className={cn('ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium', cargo.codeOn ? 'border-brand bg-brand/15 text-brand' : 'border-border text-muted-foreground')}
                      >
                        {cargo.codeOn ? '装载中' : '已关闭'}
                      </button>
                    </div>
                    <div className={cn(!cargo.codeOn && 'pointer-events-none')}>
                      {enabledPaths.length === 0 ? (
                        <div className="text-[11px] text-text-dim">未登记货舱，仅可起航于项目默认目录</div>
                      ) : (
                        <>
                          <div className="mb-2 text-[10.5px] leading-snug text-text-dim">
                            勾选要装载的目录（走 --add-dir）；点行尾「设为启动」选其一作为启动目录，不点则用默认启动目录。
                          </div>
                          <div className="overflow-hidden rounded-md border border-border">
                            {cargo.dirs.map((d) => {
                              const lit = cargo.litCwd === d.cwd
                              return (
                                <div key={d.cwd} className="flex items-center gap-2.5 border-t border-border/55 px-2.5 py-2 first:border-t-0">
                                  <button onClick={() => setCargo(toggleDir(cargo, d.cwd))} className="flex items-center">
                                    <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded border', d.loaded ? 'border-brand bg-brand text-brand-foreground' : 'border-border')}>
                                      {d.loaded && <Check2 />}
                                    </span>
                                  </button>
                                  <button onClick={() => setCargo(toggleDir(cargo, d.cwd))} className={cn('flex-1 truncate text-left font-mono text-[12px]', d.loaded ? 'text-foreground' : 'text-text-dim')}>
                                    {shortCwd(d.cwd)}
                                  </button>
                                  {d.loaded && (
                                    <button
                                      onClick={() => setCargo(anchorDir(cargo, d.cwd))}
                                      className={cn('flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px]', lit ? 'border-brand bg-brand/12 text-brand' : 'border-border text-muted-foreground hover:bg-accent')}
                                    >
                                      <AnchorIcon size={11} /> {lit ? '启动目录' : '设为启动'}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <input
                              value={extraDir}
                              onChange={(e) => setExtraDir(e.target.value)}
                              placeholder="额外目录绝对路径…"
                              className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-text-dim"
                            />
                            <button onClick={addExtraDir} disabled={!extraDir.trim()} className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] text-brand disabled:opacity-40">
                              <Plus size={12} /> 添加
                            </button>
                          </div>
                          <div className="mt-2 text-[11.5px] text-muted-foreground">
                            启动目录：{cargo.litCwd ? <span className="font-mono text-card-foreground">{shortCwd(cargo.litCwd)}</span> : <span className="text-text-dim">默认启动目录</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 5: 加摘要函数、Check 组件、Check2 勾、addExtraDir** — 在文件底部（`Radio` 函数旁）加：

```tsx
function cargoSummary(s: CargoState, dest: 'task' | 'free'): string {
  const ctxCount = (s.ctxProject ? 1 : 0) + (dest === 'task' && s.ctxTask ? 1 : 0) + (s.codeOn ? 1 : 0)
  const d = deriveLaunch(s)
  const start = d.cwd ? shortCwd(d.cwd) : '默认'
  const extra = d.addDirs.length ? ` · 装载 +${d.addDirs.length}` : ''
  return `上下文 ${ctxCount} 项 · 启动 ${start}${extra}`
}

function Check({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-2.5 text-[12.5px]', on ? 'text-card-foreground' : 'text-text-dim', className)}>
      <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded border', on ? 'border-brand bg-brand text-brand-foreground' : 'border-border')}>
        {on && <Check2 />}
      </span>
      {children}
    </button>
  )
}

function Check2() {
  return <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 3l2.2 2L8 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
```

`addExtraDir` 放进组件内部（`sail` 函数附近），调用既有 add-path API 并刷新：

```ts
  const addExtraDir = async () => {
    const cwd = extraDir.trim()
    if (!cwd || !launch?.projectId || !cargo) return
    try {
      await api.addPath(launch.projectId, cwd, { enabled: true })
      reload()                                   // 重拉项目，新目录进 pathsMeta
      setCargo({ ...cargo, dirs: [...cargo.dirs, { cwd, loaded: true }] })   // 乐观加入并默认装载
      setExtraDir('')
    } catch { /* add-path 校验失败（路径不存在等）→ 静默，不阻断 */ }
  }
```

需在文件顶部 `useData()` 解构里补 `api`/`reload`，并 `import { api } from '@/lib/api'`（确认 `data` 暴露 `reload`；若 `api` 已在 `@/lib/api` 导出则直接 import）。

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `cd web && npx tsc --noEmit && cd .. && npm test`
Expected: tsc 0 错；`npm test` 全绿（含新 helper/manifest/gate 用例）。

- [ ] **Step 7: 提交**

```bash
git add web/src/components/LaunchDialog.tsx
git commit -m "feat(web): folded 货舱 launch block — context toggles, multi-dir load, anchorable cwd"
```

---

## Task 7: 手测验证（真实 app）

**Files:** 无（运行验证）

- [ ] **Step 1: 起服务**

Run: `npm start`（默认 `:7777`）。浏览器开 `http://localhost:7777`，进 2.0 React UI。

- [ ] **Step 2: 折叠默认态** — 在某个有 ≥2 已登记目录的项目里点起航。预期：货舱折叠成 `上下文 N 项 · 启动 <某目录> · 装载 +M`；直接「起航」可成功，会话出现在列表。

- [ ] **Step 3: 启动目录可清除** — 展开「高级」，点亮目录的 ⚓「启动目录」再点一次熄灭 → 摘要变「启动 默认」、底部显示「默认启动目录」。起航后该会话 cwd 落在项目 workspace（`~/.berth/workspaces/<id>`）。

- [ ] **Step 4: 多目录装载** — 勾选 ≥2 目录、点亮其一为启动。起航后在该 session 里让 agent `ls` 或读另一目录文件，确认 `--add-dir` 目录可达（或查服务端 spawn 日志含多个 `--add-dir`）。

- [ ] **Step 5: 上下文门控** — 关掉「项目上下文」「任务上下文」，起航；确认 agent 启动时未注入项目/任务索引（claude 无 system-prompt 上下文 / codex·coco hook 不 cat 内容）。再单独保留任务上下文，确认只剩任务段。

- [ ] **Step 6: 1 个货舱也能清除** — 在只登记 1 个目录的项目里起航，展开后能熄灭 ⚓ 回退默认（修复原死角）。

- [ ] **Step 7: 额外目录** — 输入一个存在的绝对路径点「添加」，新行出现并默认勾选；起航后该目录经 `--add-dir` 可达。输入不存在路径点添加 → 静默不崩。

- [ ] **Step 8: 回归** — `npx tsc --noEmit`（根与 `web/`）、`npm test` 全绿后，若一路未提交则补一次收尾 commit。

---

## Self-Review notes

- **Spec 覆盖**：三级开关→Task1+4+6；多目录 add-dir→Task3+4+6；可清除 cwd→Task4(anchor/toggle)+6；后端校验→Task2/3；docsRoot 隐藏→Task3(ctxAddDirs 不进 UI)；默认全装载→Task4 initCargo；每次重置→Task6 useEffect；额外目录→Task6。
- **类型一致**：`CargoState`/`CargoLaunch`/`deriveLaunch`/`toggleDir`/`anchorDir`/`setCode`/`initCargo` 全任务同名；`parseContextGates`/`validateAddDirs` 同签名；`include:{project,task}` 贯穿 manifest↔handleFresh。
- **风险点**：Task6 是大改动，UI 细节以 mockup v2 为准；`api`/`reload` 的具体来源在 Step 5 标注需按 `@/lib/data`/`@/lib/api` 实际导出确认（实现时先看一眼再接）。
