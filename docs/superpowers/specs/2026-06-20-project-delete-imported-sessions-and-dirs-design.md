# 项目下已导入的会话和会话目录允许删除 — 设计

状态：已确认设计，待写实现计划
分支：`release/berth-2.0-ia`
日期：2026-06-20

## 1. 问题

在**项目工作区**（`ProjectWorkspace`）的「会话（船只）」模块里，会话行今天只有一个 Pin 动作，cwd 分组（会话目录）的组头只有一个「导入更多」动作。用户无法把一个**已导入的会话**或一个**会话目录（cwd 分组）**从项目里删除 —— 一旦某个会话/目录进入项目视图，就只能留着。

参考：货舱登记表（`CargoDefaults` / `project_path`）早已支持移除一行（`POST /projects/path/remove`），但那只删「默认装载 cwd 登记」，不影响任何已导入会话。会话本身的删除是缺口。

## 2. 范围与非目标

**范围**：项目工作区「会话」模块的会话行与 cwd 分组组头，新增删除能力。

**非目标 / 明确不做**：
- **不删除磁盘上的会话转录文件**。Berth 不拥有 `~/.claude` `~/.codex` `~/Library/Caches/coco` 下的 jsonl —— 所有现有「删除」（货舱移除、`DELETE /session-dirs`、`deleteTask` 软删）都不碰磁盘文件，本设计沿用此约定。
- 不动「无归属」页（`Unassigned.tsx`）的会话行。该页是另一个入口，本任务只覆盖项目工作区。
- 不新增 store 方法 —— 复用既有的 `removeSessionImport` / `setAttach`。

## 3. 删除语义（两种，作为 `⋯` 菜单两项）

每个会话行、每个 cwd 分组组头挂一个 `⋯` 菜单，含两个动作：

| 动作 | 语义 | store 调用 | 结果 |
|------|------|-----------|------|
| **移出项目** | detach，回到「无归属」 | `setAttach(id, null, 'confirmed')` | 会话脱离本项目，仍留在 Berth，重新出现在「无归属」列表等待重新归类 |
| **取消导入**（danger） | 从 Berth 可见集移除 | `removeSessionImport(id)` **+** `setAttach(id, null)` | 会话从 Berth 会话列表整体消失——**除非**它仍被其它独立信号保留（见下「保留信号」） |

### 3.1 「取消导入」连带 detach

一个会话不应处于「已 detach 项目但仍 imported」与「仍 attached 但已 unimported」这种矛盾态。**取消导入 = `removeSessionImport` + `setAttach(id, null)`**，语义上「彻底移出本项目视图」。

### 3.2 保留信号（取消导入后仍可能可见）

`curatedSessionIds()`（`src/sessions.ts`）由多个**独立** OR 信号合成。取消导入只清除 `session_import` 与 `attach` 两项；以下任一仍会让会话继续浮现，这是**预期行为**，不在本任务里改动：
- **pinned**（`pin` 表）—— 用户显式钉住；
- **edged**（`edge` 表）—— 关联到任务；
- **bound launch**（`allBoundLaunchSessionIds`）—— Berth 亲自起的会话，按会话粒度恒为 curated；
- **cwd 命中导入目录根**（`session_import_dir`）—— 其 cwd 精确等于某个 `导入目录`。

> 含义示例：本设计文档所在的这个 Claude 会话，其 cwd 就是项目 workspace 目录、且是 bound launch，所以即便「取消导入」它仍会在「项目默认目录」组里出现。这是正确的——它确实是 Berth 起的、属于本项目的活跃会话。「取消导入」对它而言主要是清掉显式 import 标记，不保证让它消失。UI 文案与确认弹窗需如实反映这一点（见 §6）。

## 4. 后端：两个批量端点

加在 `src/server/api.ts`，紧邻既有的 `POST /session-import`（约 L347）。两者都接收 id 列表（批量，使一次 cwd 分组操作只发一个请求），处理后调 `refresh()` 让 cache 重新派生，返回新计数。

```ts
// 移出项目：把给定会话从其项目分离（回到无归属）。不碰 session_import，不碰磁盘。
api.post('/sessions/detach', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) store.setAttach(id, null, 'confirmed')
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// 取消导入：从 Berth 可见集移除 + detach。其它保留信号（pin/edge/bound/import-dir）仍可能保活。
api.post('/session-import/remove', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) { store.removeSessionImport(id); store.setAttach(id, null, 'confirmed') }
  refresh()
  res.json({ ok: true, count: getCache().length })
})
```

设计取舍：
- **POST（非 DELETE）+ 两段路径**，与既有 `POST /projects/path/remove` 同理由（避免被 `:id` 路由吃掉、body 带数组更顺手）。
- **批量**：cwd 分组的「移出整组 / 取消导入整组」一次调用。
- **不新增 store 方法**：`removeSessionImport`（store.ts L237）、`setAttach`（L120）均已存在。

## 5. 前端

### 5.1 抽出共享菜单组件

`TaskCard.tsx` 内部私有的 portal 菜单原语（`AnchoredPopover`、`MenuItem`、`MenuLabel`）抽到新文件 `web/src/components/ui/menu.tsx`，`TaskCard` 改为从那里 import（**纯搬迁，零行为变化**）。`SessionModule` 复用同一套 —— 样式一致，契合 IA spec 的「⋯ 菜单 portal」。

> 这是本任务**唯一**的「顺手改进」：会话模块要 `⋯` 菜单，而唯一现成实现锁在 TaskCard 里。不做更大范围重构。

### 5.2 SessionModule：行级与组级 `⋯`

`web/src/components/workspace/SessionModule.tsx`：
- `Row`（会话行）：Pin 按钮旁加 `⋯` → 菜单 `[移出项目, 取消导入(danger)]`。新增可选回调 props `onDetach?(id)` / `onUnimport?(id)`。
- `Section`（cwd 分组组头）：在既有 import 按钮旁加 `⋯` → `[移出整组, 取消导入整组(danger)]`，作用于该组全部会话 id。新增可选回调 `onDetachGroup?(ids)` / `onUnimportGroup?(ids)`。
- `SessionModule` 把这些回调透传下去；workspace 组（`kind === 'workspace'`，项目默认目录）是否给组级动作见 §6.3。

### 5.3 api 客户端

`web/src/lib/api.ts` `api` 对象里加两个方法（紧邻 `importSessions`）：

```ts
detachSessions: (ids: string[]) =>
  send('POST', '/api/sessions/detach', { ids }) as Promise<{ ok: boolean; count: number }>,
unimportSessions: (ids: string[]) =>
  send('POST', '/api/session-import/remove', { ids }) as Promise<{ ok: boolean; count: number }>,
```

### 5.4 ProjectWorkspace 接线

`web/src/pages/ProjectWorkspace.tsx`：新增 handler → 调 api → `reload()`（重拉 sessions/attach）。与既有 `onPin` 同形（`.then(reload).catch(reload)`）。组级动作走 §6 的确认。

## 6. 确认与文案

### 6.1 行级：不弹确认

单个会话的「移出项目」「取消导入」都可逆（重新归类 / 重新导入），不打断。

### 6.2 组级：弹确认

「移出整组 / 取消导入整组」影响 N 个会话，用 `window.confirm` 弹一句，含数量，例：
- 移出整组：`将该目录下的 N 个会话移出本项目（仍保留在 Berth，可在「无归属」重新归类）？`
- 取消导入整组：`从 Berth 会话列表移除该目录下的 N 个会话？不会删除磁盘上的转录文件。`

### 6.3 workspace 组（项目默认目录）的特例

该组的会话多为 bound-launch（§3.2 保留信号），「取消导入」往往不会让它们消失。两个选择：
- **(选定)** workspace 组**仍提供**组级 `⋯`，但确认文案追加一句提示：`部分由 Berth 起的会话可能仍会显示（它们属于本项目的活跃会话）。`——动作仍有意义（清显式 import 标记 / detach），只是不承诺消失。
- 备选：workspace 组隐藏组级 `⋯`。否决，因为行级动作仍可用、会造成「为什么这组没有菜单」的不一致。

## 7. 测试

### 7.1 后端（`test/api.test.ts`）

该文件用 mock store（见顶部 `mockGetStore`）。新增 `mockRemoveSessionImport = vi.fn()` 并挂进 mock store（`removeSessionImport: mockRemoveSessionImport`，`setAttach` 已有 `mockSetAttach`）。新增用例：
- `POST /sessions/detach` —— ids 列表 → 每个 id 调一次 `setAttach(id, null, 'confirmed')`，调 `refresh`，返回 `{ok:true,count}`。
- `POST /session-import/remove` —— ids 列表 → 每个 id 调 `removeSessionImport(id)` **且** `setAttach(id, null, ...)`，调 `refresh`。
- 两者：空 body / 非数组 / 空数组 → 400，且不调任何 store mutation。

### 7.2 store 层

`removeSessionImport` / `setAttach` 已有覆盖（`test/store.test.ts` 的 `session_import` CRUD、attach 用例），无需新增。

### 7.3 前端

无现成组件测试基础设施（项目当前阶段）。手动验证：行级两动作、组级两动作（含确认）、workspace 组特例文案。

## 8. 数据流

```
用户点 ⋯ → 选动作
  → (组级) window.confirm
  → api.detachSessions(ids) / api.unimportSessions(ids)
  → POST /api/sessions/detach | /api/session-import/remove
  → store.setAttach / store.removeSessionImport (+setAttach)
  → refresh(): collectLogicalSessions → filterImportedSessions(curatedIds) → cache
  → 前端 reload() → GET /api/sessions → 重渲染（被移出的会话不再属于本项目分组）
```

## 9. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/server/api.ts` | +2 端点 `POST /sessions/detach`、`POST /session-import/remove` |
| `web/src/components/ui/menu.tsx` | **新建**：从 TaskCard 抽出 `AnchoredPopover`/`MenuItem`/`MenuLabel` |
| `web/src/components/workspace/TaskCard.tsx` | 改为从 `ui/menu` import（纯搬迁） |
| `web/src/components/workspace/SessionModule.tsx` | `Row` + `Section` 加 `⋯` 菜单与回调 props |
| `web/src/lib/api.ts` | +`detachSessions`、`unimportSessions` |
| `web/src/pages/ProjectWorkspace.tsx` | 接线 handler + 组级确认 |
| `test/api.test.ts` | +`mockRemoveSessionImport`，+两端点用例 |
```
