# 一键根据会话内容创建并关联任务 — Design

Date: 2026-06-28
Branch: `release/quick-create-task-from-session`

## Problem

在会话的「关联任务」下拉里，用户搜索半天找不到合适的已有任务时，没有顺手新建的出口——只能跳去别处建任务、再回来手动关联，链路断裂。

## Goal

在关联任务下拉顶部加一个入口：**「找不到合适的任务？一键创建任务」**。点击后，由 berth agent 根据**当前会话的对话内容**生成一个新任务（标题 + 摘要），创建到会话所属项目下，并**自动关联到当前会话**。

## Non-goals

- 不做手动填写标题/选项的表单（已有 `NewTaskDialog` 覆盖那条路径，这里要的是「一键」）。
- 不改既有 `关联/取消关联` 行为。
- 不引入新的 LLM/CLI；复用现有 berth agent（默认 `claude` + `claude-haiku-4-5`）。

## UX

### 入口

`TaskTag`（`web/src/components/workspace/SessionModule.tsx`）的 `AnchoredPopover` 内，搜索框下方、`关联任务` 列表标题（`MenuLabel`）**上方**，固定一行：

```
✨ 找不到合适的任务？一键创建任务
```

- 对所有会话都展示（无论当前是否已关联任务）。已关联时再点，就是再建一个任务并改关联到新任务。
- 用 sparkle 类图标（lucide，已在用 `Check`），与现有 `MenuItem` 同一视觉规格。

### 交互（立即关闭 + 标签区 loading）

1. 点击入口 → **立即关闭 popover**，并清空搜索词。
2. 会话行的「关联任务」标签（`TaskTag` 触发按钮本体）进入 loading 态：显示 `创建中…` + spinner，按钮禁用，期间不可再次点击。
3. 成功：服务端已把新任务建好并关联，前端 `reload()` 后标签自然变为新任务标题，loading 收起。
4. 失败：loading 收起，标签恢复原状（仍为原关联或未关联），用一个轻量提示（toast / 行内短提示）告知失败，用户可重试或手动选。

loading 态由 `TaskTag` 自身的本地 state 持有（因为 popover 已关闭，但触发按钮始终挂载）。

### 边界

- 会话无 transcript / 对话为空 → 服务端返回 4xx，前端提示 `会话内容为空，无法创建`，不进 loading 残留。
- agent 超时/失败 → 同失败路径。任务**未**创建（见下：仅在拿到标题后才 createTask）。

## Server

### 新增 endpoint

`POST /api/todos/from-session`，body `{ sessionId: string, projectId?: string }`。

handler（`src/server/api.ts`，挨着现有 `/todos`）：

1. 校验 `sessionId`，从 session cache 找到会话，取 `contentSourcePath`。
2. `digest = extractConversation(readTranscript(contentSourcePath), 6000)`（复用 `src/agent/transcript.ts` + `src/server/context-consolidate-service.ts`）。`digest` 为空 → `400 { error: 'empty session content' }`。
3. 编排逻辑放进一个内聚函数 `createTaskFromSession(...)`（建议落 `src/data/task-from-session.ts`，依赖清晰、可单测）：
   1. `title = (await generateTaskTitle(digest, resolveBerthAgent(store))).trim()`；空 → 抛错（→ 502）。
   2. `result = await createTask(store, getDocStore(store), title, { projectId, autoTitle: false })`。
      - `projectId` 缺省时由 `createTask` 现有的项目解析逻辑处理；正常会带上会话所属项目。
   3. 取 `result.record.id`，调用与 `/edge` 同一条链路的 `setEdge(session, taskId)`，把会话关联到新任务。
   4. `await generateTaskSummary(store, taskId)`（复用 `src/data/task-summary.ts`）——此时会话已关联，digest provider 会把会话内容折进任务摘要，**摘要由此而来，无需额外起一次 agent 提示**。该步 best-effort：失败不回滚任务/关联，只是没摘要。
   5. `broadcastDataChanged()`；返回 `{ record }`。

注意点 / landmines：
- `createTask` 的 `autoTitle` 只对入参 text 生效，与会话无关，这里**已自行生成标题**，故传 `autoTitle: false`，避免二次 agent 调用。
- summary 走「先关联、再 `generateTaskSummary`」，复用现成 digest provider（`store-singleton.ts` 里按 `edgesByTodo` 取已关联会话的 `extractConversation`），不重复实现会话读取。
- agent 调用有超时（title 45s / 60s fallback）。整条链路在一个请求里串行，端到端可能十几秒；前端是「立即关闭 + 标签 loading」，可接受。

## Client

### `web/src/lib/api.ts`

```ts
createTaskFromSession: (sessionId: string, projectId?: string) =>
  send('POST', '/api/todos/from-session', { sessionId, projectId }),
```

### `web/src/pages/ProjectWorkspace.tsx`

新增 handler，传给 `SessionModule` → `TaskTag`：

```ts
const onCreateTaskFromSession = (sessionId: string) =>
  api.createTaskFromSession(sessionId, id).then(() => reload())
```

返回的 promise 用于驱动 `TaskTag` 的 loading；reject 时由 `TaskTag` 捕获并提示。

### `web/src/components/workspace/SessionModule.tsx`（`TaskTag`）

- 新增 prop：`onCreateTaskFromSession: (sessionId: string) => Promise<void>`。
- 新增本地 state：`const [creating, setCreating] = useState(false)`。
- popover 内，`MenuLabel` 之上加一行 `MenuItem`（带 sparkle 图标），文案「找不到合适的任务？一键创建任务」。
- 点击：
  ```ts
  const createFromSession = async (e: React.MouseEvent) => {
    e.stopPropagation()
    close()                 // 立即关闭 + 清空搜索词
    setCreating(true)
    try { await onCreateTaskFromSession(s.id) }
    catch { /* 轻量失败提示 */ }
    finally { setCreating(false) }
  }
  ```
- 触发按钮：`creating` 时渲染 spinner + `创建中…`，并 `disabled`。

## Testing

- **server 单测**（`src/data/task-from-session.test.ts`，遵循现有 data 层测试风格）：
  - mock agent（stub `generateTaskTitle` / agent runner）：给定一段会话 transcript，断言 createTask 被以生成标题调用、edge 已建立、返回 record。
  - 空 digest → 抛错/400 路径。
- **既有回归**：`npx tsc --noEmit` clean + `npm test` green。
- agent 真实调用走 `*.live.test.ts`（`BERTH_LIVE=1`）即可，不进默认 CI。

## Files touched

- `src/server/api.ts` — 新 `POST /todos/from-session` handler。
- `src/data/task-from-session.ts` — 新编排函数（digest → title → create → link → summary）。
- `src/data/task-from-session.test.ts` — 单测。
- `web/src/lib/api.ts` — `createTaskFromSession`。
- `web/src/pages/ProjectWorkspace.tsx` — handler 接线。
- `web/src/components/workspace/SessionModule.tsx` — 入口行 + loading 态 + 新 prop。
