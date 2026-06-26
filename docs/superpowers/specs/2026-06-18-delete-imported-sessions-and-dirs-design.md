# 2.0：项目下已导入的会话和会话目录允许删除 — 设计

- 日期：2026-06-18
- 分支：`release/berth-2.0-ia`
- 所属：Berth 2.0 IA（会话粒度导入模型之后的补全，见
  [`2026-06-17-project-cwd-cargo-session-import-design.md`](./2026-06-17-project-cwd-cargo-session-import-design.md)）

## 1. 背景与问题

项目工作区的「会话（船只）」模块（`web/src/components/workspace/SessionModule.tsx`）当前只给：

- 会话行（`Row`）：`Pin` 切换，**没有任何移除动作**。
- cwd 分组头（`Section`）：`导入该目录下磁盘上的其他会话`（`FolderInput`），**没有移除动作**。

而 IA spec（`2026-06-17-berth-2.0-ia-design.md` §2.3）规定会话行 hover 动作应含
`⋯[移出项目, 停止会话]`。货舱路径登记表（`CargoDefaults`）已有「移除」（`X` → `POST /projects/path/remove`），
但那只删登记的 cwd 路径，**不动已导入会话**。

所以缺口是：**项目下已导入的会话、以及按 cwd 聚合的会话目录（分组），都无法移除/删除**。

## 2. 语义（已与 owner 确认：两种语义都要，做成 `⋯` 菜单两项）

两种语义**都不会删除磁盘上的会话转录文件** —— Berth 不拥有 CLI store 里的 jsonl，删除只改 Berth 自己的登记。
这与既有 `DELETE /session-dirs`（只删导入目录登记）、`POST /projects/path/remove`（注释明言「does not touch
any already-imported sessions」）一致。

| 菜单项 | store 操作 | 效果 |
|--------|-----------|------|
| **移出项目** | `setAttach(id, null, 'confirmed')` | 会话脱离本项目，仍留在 Berth；若仍在 `session_import` 集合则回到「无归属」列表等待重新归类。 |
| **取消导入** | `removeSessionImport(id)` + `setAttach(id, null)` | 取消会话粒度导入信号并脱离项目；除非其 cwd 仍匹配某个 `session_import_dir` 根、或它被 pin/edge（这些信号独立、刻意保留），否则从 Berth 会话列表整体消失。 |

会话在项目工作区里出现的唯一原因是 `attach.projectId === id`（`ProjectWorkspace` 的
`projSessions = sessions.filter(s => s.projectId === id)`）。因此两种语义都先 detach，必然把会话移出当前项目视图。

### 判断点（已确认）
1. **「取消导入」隐含 detach**：一个会话不应「已脱离导入集合却仍 attach 在项目上」，所以取消导入必然同时 detach。
2. **仅分组级动作需要二次确认**：分组动作影响 N 个会话，给 `window.confirm`；单行动作可逆（可重新导入/重新归类），不弹确认。

## 3. 后端（`src/server/api.ts`）

新增两个**支持批量**的端点（批量是为了分组动作一次调用搞定）。两者都在改完后调用 `refresh()`，
让 `cache` 依据 `curatedSessionIds()` 重新派生（detach 后若会话不再被 curated 就从 cache 掉出）。

```ts
// 移出项目（保留导入信号）：批量 detach
api.post('/sessions/detach', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) store.setAttach(id, null, 'confirmed')
  refresh()
  res.json({ ok: true, count: getCache().length })
})

// 取消导入（同时 detach）：批量 un-import
api.post('/session-import/remove', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
  if (!ids.length) return res.status(400).json({ error: 'ids:string[] required' })
  const store = getStore()
  for (const id of ids) { store.removeSessionImport(id); store.setAttach(id, null, 'confirmed') }
  refresh()
  res.json({ ok: true, count: getCache().length })
})
```

- **不新增 store 方法**：`removeSessionImport(id)`、`setAttach(id, null, …)` 均已存在（`src/db/store.ts:237`、`:120`）。
- 端点路径选择：`/session-import/remove` 与既有 `POST /session-import`（导入）成对；`/sessions/detach`
  与既有 `POST /attach` 同域（`/attach` 是单会话，detach 端点是批量，分组动作用它）。两段式路径，
  不会被 `DELETE /projects/:id` 之类的单段路由遮蔽。

## 4. 前端

### 4.1 抽取共享菜单
把 `TaskCard.tsx` 内私有的 `AnchoredPopover`、`MenuItem`、`MenuLabel`（portal 锚定下拉）抽到
`web/src/components/ui/Menu.tsx` 并导出；`TaskCard` 改为从该文件 import（纯搬移，零行为变化）。
`SessionModule` 复用同一套，样式与 spec 的「⋯ menu portal」一致。

### 4.2 `SessionModule.tsx`
- `Row`：在 Pin 按钮旁加 `⋯`（`MoreHorizontal`，hover 显形、与 Pin 一致的 group-hover 规则）。
  菜单项：`移出项目`、`取消导入`（danger 着色）。新增 props：`onDetach?(id)`、`onUnimport?(id)`。
- `Section`（cwd 分组头）：在现有 `FolderInput` 导入按钮旁加 `⋯`。菜单项：`移出整组`、`取消导入整组`（danger）。
  新增 props：`onDetachGroup?()`、`onUnimportGroup?()`，由分组把自己的 `rows.map(r => r.id)` 传出去。
- Pin 分组、workspace 分组：是否给分组级 `⋯` 由是否传入对应回调决定（与现有 `onImport` 同款「传则显」）。
  Pin/workspace 行仍可单行移出/取消导入。

### 4.3 `web/src/lib/api.ts`
```ts
detachSessions: (ids: string[]) => send('POST', '/api/sessions/detach', { ids }),
unimportSessions: (ids: string[]) => send('POST', '/api/session-import/remove', { ids }),
```
（沿用文件里既有的 `send(method, url, body)` 包装；url 带 `/api` 前缀，与 `importSessions` 等同款。）

### 4.4 `ProjectWorkspace.tsx`
新增处理器，调用 API 后 `reload()`（attach/import 变化由 `serialize()` + cache 重算反映；
与 `onPin`/`onDelete` 同款 `.then(reload).catch(reload)`）：
- `onDetach(id)` / `onUnimport(id)`：单会话，不确认。
- `onDetachGroup(ids)` / `onUnimportGroup(ids)`：`window.confirm` 后再调，文案点明影响会话数。

## 5. 测试

- `test/api.test.ts`：mock store 增加 `mockRemoveSessionImport`，复用既有 `mockSetAttach`。
  覆盖：
  - `POST /sessions/detach` { ids:[a,b] } → 对每个 id `setAttach(id, null, 'confirmed')`、调用 `refresh`、200。
  - `POST /session-import/remove` { ids:[a] } → `removeSessionImport(a)` + `setAttach(a, null, …)`、`refresh`、200。
  - 两者空/缺 `ids` → 400。
- `test/store.test.ts`：`removeSessionImport` 已有覆盖（`session_import` CRUD），不重复。
- 前端无单测框架（仓库现状），不新增前端测试；靠 `npx tsc --noEmit` 守类型。

## 6. 非目标（YAGNI）
- 不实现「停止会话」（spec 菜单里的另一项）——属另一任务。
- 不删除磁盘转录文件，不提供任何「彻底删盘」入口。
- 不改 `无归属`（Unassigned）页与 `CargoDefaults` 货舱登记表（其移除已存在）。
- 不做多选/框选批量；分组级批量已覆盖「成片移除」诉求。

## 7. 验收
1. 项目工作区会话行 `⋯` → `移出项目`：会话从该项目消失，出现在「无归属」。
2. 会话行 `⋯` → `取消导入`：会话从 Berth 会话列表消失（cwd 不匹配任何导入目录根、且未 pin/edge 时）。
3. cwd 分组头 `⋯` → `移出整组` / `取消导入整组`：确认后整组按上述语义处理。
4. 磁盘上的 jsonl 转录文件不被改动/删除。
5. `npx tsc --noEmit` 干净；`npm test` 绿（含新增 api 测试）。
