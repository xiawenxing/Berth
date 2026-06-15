# 任务 DDL 标记 + now 视图「今日待处理任务」— 设计

> 状态：已确认设计，待写实现计划。
> 分支：`feat/context-agent-update`（或为本功能新开分支）。

## 目标 / 验收标准

1. 任务可以标记一个 **DDL（截止/处理日期）**，本地存储、**不同步**到飞书等外部源。
2. now 视图原来的「进行中任务」列表，改成 **「今日待处理任务」** 列表：显示 `ddl ≤ 今天`
   且状态非「已完成/已取消」的任务（逾期的也算今日要处理），逾期排最前。
3. 标记方式简洁，三种操作：
   - **今日处理** — 把 ddl 设为今天。
   - **later** — 手动输入一个日期，把 ddl 设为该日期。
   - **清除日期** — 清除 ddl。
4. 标记控件出现在**项目工作台的任务卡片**上（所有任务都在那里，含未排期的）。now 视图
   今日列表的行上**只读展示** ddl chip（逾期 N 天 / 今日），不在 now 视图提供标记入口。

## 非目标 (YAGNI)

- 不做时间（小时/分钟）、不做时区处理 —— ddl 只是一个本地日期 `YYYY-MM-DD`。
- 不同步到飞书/外部源，不进 `TaskFields`，不碰同步适配器与字段映射。
- 不做重复/提醒/通知。
- 不在 now 视图提供新增 ddl 的入口（未排期任务从工作台标记）。

## 数据模型（本地，不同步）

镜像 `pin` 的本地 overlay 模式，但键是 `task.id`：

- 在 `src/data/store-data.ts` 的 schema 里新增：
  ```sql
  CREATE TABLE IF NOT EXISTS task_ddl ( task_id TEXT PRIMARY KEY, ddl TEXT NOT NULL );
  ```
  `ddl` 存纯本地日期串 `YYYY-MM-DD`。软 FK（沿用本仓 `pragma foreign_keys = OFF`）；
  孤儿行无害。

- store 方法（加到 `openStore` 返回对象，与既有 task 方法并列）：
  - `setTaskDdl(id: string, date: string | null)` —— `null`/空串 → `DELETE`；否则 upsert。
    写入前断言 `date` 匹配 `^\d{4}-\d{2}-\d{2}$`，不匹配抛错。
  - `allTaskDdls(): Map<string, string>` —— 一次性读全表。
  - 任务删除路径（`deleteTask` / 软删）顺带 `DELETE FROM task_ddl WHERE task_id=?`，
    避免孤儿堆积（可选，最小实现可省，靠软 FK 容忍）。

`ddl` **不是** `TaskFields` 成员；`types.ts` 不改 `TaskFields`。

## API (`src/server/api.ts`)

- `GET /api/todos`：每条任务多带 `ddl: string | null`。在 handler 里取一次
  `store.allTaskDdls()`，map 时 `ddl: ddlMap.get(t.id) ?? null`。
- `PATCH /api/todos/:id`：新增可选字段 `ddl`。语义：
  - `ddl === undefined` → 不动。
  - `ddl === null` → `store.setTaskDdl(id, null)`（清除）。
  - `ddl` 为 `'YYYY-MM-DD'` 合法串 → `store.setTaskDdl(id, ddl)`。
  - 其它（格式非法）→ `400`。
  `ddl` 独立于现有 `updateTask(...)`（后者只处理 TaskFields），在路由里单独分支处理，
  保持 title/priority/status/progress 行为不变。

## 前端

### now 视图（`renderNow`，`public/app.js` ~2821）

替换「⏳ 进行中任务」段：

- 标题 → `今日待处理任务`（icon 可用 `calendar-check` 或保留 `hourglass`）。
- 过滤（前端纯逻辑，建议抽成可单测的纯函数 `todayTodos(todos, todayStr)`）：
  `t.ddl != null && t.ddl <= todayStr && !DONE_STATUSES.has(t.status)`。
- 排序：ddl 升序（最逾期在前）→ 再按优先级。
- 行内 ddl chip：
  - `t.ddl < today` → 红色 chip「逾期 N 天」（N = 本地日期差）。
  - `t.ddl === today` → 中性 chip「今日」。
- 行的状态 chip 用任务真实状态（不再写死「进行中」），复用 `statusClass`。
- 空态：`（今日无待处理任务）`。
- `today` 用本地日期算：`new Date()` → `YYYY-MM-DD`（本地，不用 UTC）。

### 项目工作台任务卡片（`buildWorkspaceTodoItem`，`public/app.js` ~2240）

在卡片行加一个轻量 ddl 控件（放在 `起会话` 按钮旁）：

- 形态：一个小按钮/chip → 点开一个 3 项 inline 菜单 / popover：
  - **今日处理** → `PATCH {ddl: 今天}`
  - **later** → 展开原生 `<input type="date">`（默认值=明天），选定后 `PATCH {ddl: 选定}`
  - **清除日期** → `PATCH {ddl: null}`（仅当已有 ddl 时可见/可用）
- 卡片若已有 ddl，按钮位置显示当前 ddl chip（同 now 视图的逾期/今日/未来日期样式），
  点它即打开同一菜单改期/清除。
- 复用现有 PATCH 客户端封装；成功后乐观更新本地 `allTodos[*].ddl` 并 `renderNow()` +
  重渲染工作台，与现有 status/priority 编辑后的刷新路径一致。

### 样式（`public/style.css` / `components.css`）

- 新增 `.ddl-chip`（中性/今日）、`.ddl-chip.overdue`（红）、`.ddl-chip.future`（弱化）等，
  复用 tokens 颜色，不写死 hex。

## 测试

- store 单测（`store-data` 或新测试文件）：`setTaskDdl` 设置/清除/非法格式抛错；
  `allTaskDdls` 返回正确 map；任务删除清理 ddl 行（若实现）。
- API 单测（`api.test.ts`）：`PATCH /todos/:id` 设置 / 清除(null) / 非法格式→400；
  `GET /todos` 带回 `ddl`。
- 前端纯函数单测（若抽出）：`todayTodos` 过滤+排序、逾期天数计算（含跨月）。

## 影响面 / 风险

- 仅新增一个本地表 + 一个 API 字段 + 前端两处渲染，**不碰同步/PTY/launch 路径**。
- now 视图语义从「进行中」变「今日待处理」是用户明确要求的行为变更；进行中但未排期的任务
  不再出现在 now 视图（从工作台标记后才进今日列表）—— 已与用户确认。
- 「今天」按浏览器本地时区计算；服务端不参与日期判断，无跨时区不一致风险。
