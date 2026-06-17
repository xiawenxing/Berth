# 项目下删除已导入会话 / 会话目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目工作区「会话」模块支持移除已导入会话与按 cwd 聚合的会话目录——两种语义（移出项目 / 取消导入），均不动磁盘转录文件。

**Architecture:** 后端加两个批量端点（detach / un-import），复用既有 store 方法并 `refresh()` 重算 cache；前端把 `TaskCard` 私有的 portal 菜单原语抽到共享文件，`SessionModule` 的会话行与 cwd 分组头各挂一个 `⋯` 菜单，`ProjectWorkspace` 接线（分组级动作加二次确认）。

**Tech Stack:** TypeScript, Express, better-sqlite3, Vitest（后端）；React + Vite + Tailwind + lucide-react（前端，无单测，靠 `npx tsc --noEmit` 守类型）。

参考 spec：`docs/superpowers/specs/2026-06-18-delete-imported-sessions-and-dirs-design.md`

---

## File Structure

- `src/server/api.ts` — 新增 `POST /sessions/detach`、`POST /session-import/remove` 两个路由（Modify）。
- `test/api.test.ts` — mock store 加 `removeSessionImport`，新增两个端点的测试（Modify）。
- `web/src/components/ui/menu.tsx` — 新建，导出 `AnchoredPopover` / `MenuLabel` / `MenuItem`（Create）。
- `web/src/components/workspace/TaskCard.tsx` — 删除这三个本地原语，改为 import（Modify）。
- `web/src/lib/api.ts` — 加 `detachSessions` / `unimportSessions`（Modify）。
- `web/src/components/workspace/SessionModule.tsx` — `Row`/`Section` 加 `⋯` 菜单与回调 props（Modify）。
- `web/src/pages/ProjectWorkspace.tsx` — 接线处理器 + 分组级 `window.confirm`（Modify）。

不新增 store 方法：`removeSessionImport`（`src/db/store.ts:237`）、`setAttach`（`:120`）已存在。

---

## Task 1: 后端两个移除端点（TDD）

**Files:**
- Modify: `test/api.test.ts`（mock store + 新测试块）
- Modify: `src/server/api.ts:344-357`（在 `POST /session-import` 之后插入）

- [ ] **Step 1: 给 mock store 加 `removeSessionImport`**

在 `test/api.test.ts` 的 `mockGetStore` 返回对象里（紧挨现有 `addSessionImport: mockAddSessionImport,` 一行）加入 mock，并在文件顶部 mock 声明区（`const mockAddSessionImport = vi.fn(...)` 附近）补一个：

```ts
// 顶部声明区，挨着 mockAddSessionImport：
const mockRemoveSessionImport = vi.fn((..._a: any[]) => {})
```

```ts
// mockGetStore 返回对象里，紧跟 addSessionImport 那行：
removeSessionImport: mockRemoveSessionImport,
```

- [ ] **Step 2: 写失败测试**

在 `test/api.test.ts` 的 `describe('货舱 path + session-import API', …)` 块**之后**新增一个 describe（注意把新 mock 加进该块的 `beforeEach` 清理）：

```ts
describe('session removal API (detach / un-import)', () => {
  beforeEach(() => {
    mockSetAttach.mockClear(); mockRemoveSessionImport.mockClear()
  })
  const J = { 'Content-Type': 'application/json' }

  it('detaches sessions from their project (attach → null)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/sessions/detach`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s1', 's2'] }),
    })
    expect(r.status).toBe(200)
    expect(mockSetAttach).toHaveBeenCalledWith('s1', null, 'confirmed')
    expect(mockSetAttach).toHaveBeenCalledWith('s2', null, 'confirmed')
    expect(mockRemoveSessionImport).not.toHaveBeenCalled()
  })

  it('rejects detach with no ids', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/sessions/detach`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: [] }),
    })
    expect(r.status).toBe(400)
  })

  it('un-imports sessions (removeSessionImport + detach)', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import/remove`, {
      method: 'POST', headers: J, body: JSON.stringify({ ids: ['s1'] }),
    })
    expect(r.status).toBe(200)
    expect(mockRemoveSessionImport).toHaveBeenCalledWith('s1')
    expect(mockSetAttach).toHaveBeenCalledWith('s1', null, 'confirmed')
  })

  it('rejects un-import with no ids', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/session-import/remove`, {
      method: 'POST', headers: J, body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `npx vitest run test/api.test.ts -t "session removal API"`
Expected: FAIL（端点尚不存在 → 404，断言不通过）

- [ ] **Step 4: 实现端点**

在 `src/server/api.ts` 的 `POST /session-import` 路由块（约 `:344-357`）**之后**插入：

```ts
// 移出项目（保留导入信号）：批量 detach。会话脱离项目、回到「无归属」（若仍在 session_import）。
api.post('/sessions/detach', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) store.setAttach(id, null, 'confirmed')
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// 取消导入：撤销会话粒度导入信号并 detach。除非 cwd 仍匹配某导入目录根或被 pin/edge，否则从列表消失。
api.post('/session-import/remove', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) { store.removeSessionImport(id); store.setAttach(id, null, 'confirmed') }
  refresh()
  res.json({ ok: true, count: getCache().length })
})
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run test/api.test.ts -t "session removal API"`
Expected: PASS（4 个用例）

- [ ] **Step 6: 全量类型检查 + 提交**

```bash
npx tsc --noEmit
git add src/server/api.ts test/api.test.ts
git commit -m "feat(berth-2.0): API — detach / un-import sessions (project removal)"
```

---

## Task 2: 抽取共享 portal 菜单原语

**Files:**
- Create: `web/src/components/ui/menu.tsx`
- Modify: `web/src/components/workspace/TaskCard.tsx`（删本地原语、改 import）

- [ ] **Step 1: 新建共享菜单文件**

创建 `web/src/components/ui/menu.tsx`，内容为从 `TaskCard.tsx:264-345` 原样搬出的三个原语（仅加 `export`）：

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** A popover portaled to <body> and fixed-positioned under `anchor`, so it escapes ancestor
 *  overflow. Closes on outside-click (anchor included, so the trigger toggles cleanly) and Esc;
 *  flips above when near the viewport bottom. */
export function AnchoredPopover({
  anchor,
  onClose,
  width,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const H = ref.current?.offsetHeight ?? 280
      const left = Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8))
      const below = a.bottom + 4
      const top = below + H > window.innerHeight - 8 ? Math.max(8, a.top - H - 4) : below
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, width])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchor])

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-50 rounded-md border border-border bg-popover p-1 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  )
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-dim">{children}</div>
)

export const MenuItem = ({ children, onClick, danger }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-accent',
      danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground',
    )}
  >
    {children}
  </button>
)
```

- [ ] **Step 2: 从 TaskCard 删除本地原语并改用 import**

在 `web/src/components/workspace/TaskCard.tsx`：
1. 删除 `AnchoredPopover`（约 `:264-330`）、`MenuLabel`、`MenuItem`（约 `:332-345`）三段定义（连同它们上方的 `// ── shared popover primitive ──` 注释）。
2. 在文件顶部 import 区加：

```tsx
import { AnchoredPopover, MenuLabel, MenuItem } from '@/components/ui/menu'
```

3. 清理因此变为未使用的 react / react-dom import：把第 1 行
```tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
```
改为（去掉 `useLayoutEffect`、整行删掉 `createPortal`；`useEffect`/`useRef`/`useState`/`RefObject`/`ReactNode` 仍被 TaskCard 其余部分使用，保留）：
```tsx
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
```
> 注：`web/tsconfig.json` 的 `noUnusedLocals:false`，漏删不会致编译失败，但仍按上面清理以保持整洁。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 干净（无报错）

- [ ] **Step 4: 提交**

```bash
git add web/src/components/ui/menu.tsx web/src/components/workspace/TaskCard.tsx
git commit -m "refactor(berth-2.0): extract shared portal menu primitives out of TaskCard"
```

---

## Task 3: 前端 API 客户端方法

**Files:**
- Modify: `web/src/lib/api.ts`（紧跟 `importSessions` 一项，约 `:117-118`）

- [ ] **Step 1: 加两个客户端方法**

在 `web/src/lib/api.ts` 的 `importSessions:` 项之后插入：

```ts
  detachSessions: (ids: string[]) => send('POST', '/api/sessions/detach', { ids }) as Promise<{ ok: boolean; count: number }>,
  unimportSessions: (ids: string[]) => send('POST', '/api/session-import/remove', { ids }) as Promise<{ ok: boolean; count: number }>,
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 干净

> 不单独提交——与 Task 4 / 5 的 UI 接线一起在 Task 5 末尾提交（避免「定义了但无人调用」的中间态）。

---

## Task 4: SessionModule —— 会话行与 cwd 分组头各挂 `⋯` 菜单

**Files:**
- Modify: `web/src/components/workspace/SessionModule.tsx`

- [ ] **Step 1: 引入菜单原语与图标，定义复用的 RowMenu**

在 `SessionModule.tsx` 顶部 import 区：
1. lucide 图标行（第 2 行）追加 `MoreHorizontal`、`FolderMinus`、`LogOut`：
```tsx
import { Pin, ChevronDown, Anchor, Terminal, Play, Link2, RefreshCw, Box, FolderInput, MoreHorizontal, FolderMinus, LogOut } from 'lucide-react'
```
2. 新增：
```tsx
import { useRef } from 'react'
import { AnchoredPopover, MenuItem } from '@/components/ui/menu'
```
（文件已 `import { useState, type ReactNode } from 'react'`，`useRef` 单独补一行即可；或合并到该行。）

在 `Glyph` 组件**之前**加一个通用的 `⋯` 菜单触发器：

```tsx
/** 通用 ⋯ 菜单：用于会话行（移出项目 / 取消导入）与 cwd 分组头（移出整组 / 取消导入整组）。
 *  size 控制触发图标尺寸；onDetach/onUnimport 缺省则不渲染对应项。 */
function MoreMenu({
  size = 12,
  className,
  detachLabel,
  unimportLabel,
  onDetach,
  onUnimport,
}: {
  size?: number
  className?: string
  detachLabel: string
  unimportLabel: string
  onDetach?: () => void
  onUnimport?: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!onDetach && !onUnimport) return null
  const pick = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn?.()
    setOpen(false)
  }
  return (
    <button
      ref={btnRef}
      title="更多"
      onClick={(e) => {
        e.stopPropagation()
        setOpen((v) => !v)
      }}
      className={cn('flex items-center justify-center rounded hover:bg-secondary', className)}
    >
      <MoreHorizontal size={size} />
      {open && (
        <AnchoredPopover anchor={btnRef} width={168} onClose={() => setOpen(false)}>
          {onDetach && (
            <MenuItem onClick={pick(onDetach)}>
              <LogOut size={13} className="flex-none text-muted-foreground" /> {detachLabel}
            </MenuItem>
          )}
          {onUnimport && (
            <MenuItem danger onClick={pick(onUnimport)}>
              <FolderMinus size={13} className="flex-none" /> {unimportLabel}
            </MenuItem>
          )}
        </AnchoredPopover>
      )}
    </button>
  )
}
```

- [ ] **Step 2: 会话行 `Row` 加 `⋯`**

在 `Row` 组件的 props 类型里加：
```tsx
  onDetach?: (id: string) => void
  onUnimport?: (id: string) => void
```
并在解构参数里加 `onDetach, onUnimport`。

在 Row 的 hover 动作容器（现有 `<div className="flex flex-none items-center">` 内、Pin 按钮**之后**）追加：
```tsx
        <MoreMenu
          size={12}
          className="h-[22px] w-[22px] text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
          detachLabel="移出项目"
          unimportLabel="取消导入"
          onDetach={onDetach ? () => onDetach(s.id) : undefined}
          onUnimport={onUnimport ? () => onUnimport(s.id) : undefined}
        />
```

- [ ] **Step 3: `Section` 透传行级回调 + 分组头加 `⋯`**

在 `Section` 的 props 类型里加：
```tsx
  onDetach?: (id: string) => void
  onUnimport?: (id: string) => void
  onDetachGroup?: () => void
  onUnimportGroup?: () => void
```
解构参数同步加上这四个。

把渲染 `Row` 的那行透传两个行级回调：
```tsx
            <Row key={s.id} s={s} showCwd={showCwd} onOpen={onOpen} onPin={onPin} onDetach={onDetach} onUnimport={onUnimport} />
```

在分组头 `<button>` 内、现有 `onImport` 的 `FolderInput` `<span>` **之后**追加分组级菜单：
```tsx
        {(onDetachGroup || onUnimportGroup) && (
          <span role="button" tabIndex={-1} onClick={(e) => e.stopPropagation()} className="flex-none">
            <MoreMenu
              size={13}
              className="p-1 text-text-dim hover:text-foreground"
              detachLabel="移出整组"
              unimportLabel="取消导入整组"
              onDetach={onDetachGroup}
              onUnimport={onUnimportGroup}
            />
          </span>
        )}
```

- [ ] **Step 4: `SessionModule` 接收并下发回调**

在 `SessionModule` 的 props 类型里加：
```tsx
  onDetach?: (id: string) => void
  onUnimport?: (id: string) => void
  onDetachGroup?: (ids: string[]) => void
  onUnimportGroup?: (ids: string[]) => void
```
解构参数同步加上。

Pin section 的 `<Section …>` 透传行级回调（Pin 组不给分组级删除，避免误删一片 pin）：
```tsx
              <Section
                icon={<Pin size={12} className="flex-none text-priority" />}
                label="Pin"
                count={pin.length}
                rows={pin}
                showCwd
                onOpen={onOpen}
                onPin={onPin}
                onDetach={onDetach}
                onUnimport={onUnimport}
              />
```

cwd 分组的 `<Section …>`（`groups.map` 内）追加行级 + 分组级回调：
```tsx
                  onDetach={onDetach}
                  onUnimport={onUnimport}
                  onDetachGroup={onDetachGroup ? () => onDetachGroup(g.sessions.map((s) => s.id)) : undefined}
                  onUnimportGroup={onUnimportGroup ? () => onUnimportGroup(g.sessions.map((s) => s.id)) : undefined}
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 干净

> 仍不单独提交——与 Task 5 一起提交。

---

## Task 5: ProjectWorkspace 接线 + 分组级二次确认

**Files:**
- Modify: `web/src/pages/ProjectWorkspace.tsx`

- [ ] **Step 1: 加四个处理器**

在 `ProjectWorkspace` 内、`onPin` 处理器（约 `:193-198`）**之后**加：

```tsx
  // 移出项目：单会话 detach（可逆，不确认）。
  const onDetach = (sessionId: string) => {
    api.detachSessions([sessionId]).then(() => reload()).catch(() => reload())
  }
  // 取消导入：单会话 un-import（可逆，不确认）。
  const onUnimport = (sessionId: string) => {
    api.unimportSessions([sessionId]).then(() => reload()).catch(() => reload())
  }
  // 移出整组：批量 detach，影响多个会话 → 二次确认。
  const onDetachGroup = (ids: string[]) => {
    if (!ids.length) return
    if (!window.confirm(`将 ${ids.length} 个会话移出本项目（回到「无归属」）？`)) return
    api.detachSessions(ids).then(() => reload()).catch(() => reload())
  }
  // 取消导入整组：批量 un-import → 二次确认。
  const onUnimportGroup = (ids: string[]) => {
    if (!ids.length) return
    if (!window.confirm(`取消导入这 ${ids.length} 个会话？它们将从 Berth 会话列表移除（磁盘文件不受影响）。`)) return
    api.unimportSessions(ids).then(() => reload()).catch(() => reload())
  }
```

- [ ] **Step 2: 把回调传给 `SessionModule`**

把现有渲染（约 `:315`）：
```tsx
        <SessionModule pin={pin} groups={groups} onLaunch={() => launch('')} onResync={doResync} syncing={syncing} onOpen={openRow} onPin={onPin} onImport={importFromGroup} />
```
改为：
```tsx
        <SessionModule pin={pin} groups={groups} onLaunch={() => launch('')} onResync={doResync} syncing={syncing} onOpen={openRow} onPin={onPin} onImport={importFromGroup} onDetach={onDetach} onUnimport={onUnimport} onDetachGroup={onDetachGroup} onUnimportGroup={onUnimportGroup} />
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 干净

- [ ] **Step 4: 提交前端整体**

```bash
git add web/src/lib/api.ts web/src/components/workspace/SessionModule.tsx web/src/pages/ProjectWorkspace.tsx
git commit -m "feat(berth-2.0): project workspace — remove imported sessions + cwd groups (移出项目 / 取消导入)"
```

---

## Task 6: 全量校验

- [ ] **Step 1: 类型 + 单测**

Run:
```bash
npx tsc --noEmit && npm test
```
Expected: tsc 干净；vitest 全绿（含 Task 1 的 4 个新用例）。`*.live.test.ts` 默认跳过（无 `BERTH_LIVE=1`）。

- [ ] **Step 2: 手动冒烟（可选，需本机 GUI）**

Run: `npm start`，浏览器开项目工作区：
1. 会话行 hover → `⋯` → `移出项目`：会话从该项目消失，出现在「无归属」。
2. 会话行 `⋯` → `取消导入`：会话从列表消失（cwd 不匹配导入目录根、未 pin/edge 时）。
3. cwd 分组头 `⋯` → `移出整组` / `取消导入整组`：确认弹窗 → 整组按语义处理。
4. 确认磁盘 jsonl 未被改动（Berth 不写 CLI store）。

> 若已有未提交改动堆积，先确认 `git status` 干净再 `npm start`。

---

## Self-Review 记录
- **Spec 覆盖**：§2 语义（移出项目 / 取消导入）→ Task 1（后端）+ Task 4/5（UI 两项菜单）；§3 端点 → Task 1；§4.1 抽菜单 → Task 2；§4.3 client → Task 3；§4.2 SessionModule → Task 4；§4.4 ProjectWorkspace + confirm → Task 5；§5 测试 → Task 1 Step 1-5；§7 验收 → Task 6。全部有对应任务。
- **占位符**：无 TODO/TBD；每个代码步骤均给出完整代码。
- **类型一致**：`detachSessions`/`unimportSessions`（client）↔ `/sessions/detach`、`/session-import/remove`（server）↔ `onDetach`/`onUnimport`/`onDetachGroup`/`onUnimportGroup`（props 名贯穿 SessionModule 与 ProjectWorkspace）一致；`MoreMenu`/`AnchoredPopover`/`MenuItem` 签名与 Task 2 导出一致。
