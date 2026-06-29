# 一键根据会话内容创建并关联任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在会话「关联任务」下拉顶部加「一键创建任务」入口，由 berth agent 根据当前会话对话内容生成任务（标题 + 摘要）、创建到会话所属项目并自动关联。

**Architecture:** 新增一个内聚的服务端编排函数 `createTaskFromSession`（纯逻辑：digest → 标题 → 建任务 → 关联 → 触发摘要），由新 endpoint `POST /api/todos/from-session` 调用（endpoint 负责读 transcript）。前端加一个 api 方法、把 handler 顺着 `onLinkTask` 同一条 prop 链传到 `TaskTag`，并在标签按钮上做 loading。

**Tech Stack:** Node + Express-style router (`src/server/api.ts`)、SQLite store、berth agent（`generateTaskTitle` / `triggerTaskSummary`）、React + TS + Tailwind (`web/`)、vitest。

参考规格：`docs/superpowers/specs/2026-06-28-quick-create-task-from-session-design.md`

---

## Task 1: 服务端编排函数 `createTaskFromSession`（TDD）

把「digest → 标题 → 建任务 → 关联 → 触发摘要」收敛进一个纯函数，**入参是已抽取好的 digest 文本**（transcript 读取留给 endpoint），这样可单测、依赖清晰。

**Files:**
- Create: `src/data/task-from-session.ts`
- Test: `test/data-task-from-session.test.ts`

参考已有签名（实现时对齐）：
- `createTask(store, docStore, text, opts, now?) => Promise<CreateResult>`，`CreateResult` 成功分支为 `{ status: 'created'; record: { id; title; projectId; project; detailDoc? } }`（`src/data/tasks.ts:16`、`:109`）。
- `generateTaskTitle(input: string, agent?: BerthAgent) => Promise<string>`（`src/agent/index.ts:136`）。
- `resolveBerthAgent(store) => { cli; model }`（`src/data/agent-config.ts`）。
- `triggerTaskSummary(store, taskId) => boolean`（fire-and-forget，`src/data/task-summary.ts:67`）。
- store 关联 API：`store.removeEdgesForSession(sessionId)`、`store.addEdge(todoKey, sessionId)`、`store.setAttach(sessionId, projectId, 'confirmed')`（见 `src/server/api.ts:177-179`）。

- [ ] **Step 1: 写失败测试**

```ts
// test/data-task-from-session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/agent/triage', () => ({ classifyProject: vi.fn() }))
vi.mock('../src/agent/index', () => ({ generateTaskTitle: vi.fn() }))
vi.mock('../src/data/task-summary', () => ({ triggerTaskSummary: vi.fn() }))

import { openStore } from '../src/db/store'
import { createProject } from '../src/data/projects'
import { listTasks } from '../src/data/tasks'
import { classifyProject } from '../src/agent/triage'
import { generateTaskTitle } from '../src/agent/index'
import { triggerTaskSummary } from '../src/data/task-summary'
import { createTaskFromSession } from '../src/data/task-from-session'

function fakeDocStore() {
  return {
    saveAttachment: (_d: string, _h: string) => ({ rel: 'assets/x.png', abs: '/root/assets/x.png' }),
    taskDocRef: (id: string) => `tasks/${id}/index.md`,
    resolveDocPath: (ref: string) => `/root/${ref}`,
    writeDoc: (_abs: string, _content: string) => ({ mtime: 1 }),
  } as any
}

describe('data/task-from-session', () => {
  beforeEach(() => {
    ;(classifyProject as any).mockReset()
    ;(generateTaskTitle as any).mockReset()
    ;(triggerTaskSummary as any).mockReset()
  })

  it('generates a title from the digest, creates the task, links the session, triggers a summary', async () => {
    const store = openStore(':memory:')
    const proj = createProject(store, 'Berth', 'Blue')
    ;(generateTaskTitle as any).mockResolvedValue('修复会话被 kill 后状态错乱')

    const r = await createTaskFromSession(store, fakeDocStore(), 'sess-1', 'USER: 会话被 kill 了\nASSISTANT: 我来排查', { projectId: proj.id })

    expect(r.status).toBe('created')
    expect((generateTaskTitle as any).mock.calls[0][0]).toContain('会话被 kill')
    if (r.status === 'created') {
      expect(r.record.title).toBe('修复会话被 kill 后状态错乱')
      // session is now linked to the new task
      expect(store.edgesByTodo().get(r.record.id)).toContain('sess-1')
      // summary kicked off (fire-and-forget)
      expect((triggerTaskSummary as any)).toHaveBeenCalledWith(store, r.record.id)
    }
    expect(listTasks(store)).toHaveLength(1)
  })

  it('throws on empty digest (no agent call, no task)', async () => {
    const store = openStore(':memory:')
    await expect(createTaskFromSession(store, fakeDocStore(), 'sess-1', '   ', {})).rejects.toThrow(/empty session content/)
    expect((generateTaskTitle as any)).not.toHaveBeenCalled()
    expect(listTasks(store)).toHaveLength(0)
  })

  it('throws when the agent returns an empty title (no task created)', async () => {
    const store = openStore(':memory:')
    ;(generateTaskTitle as any).mockResolvedValue('   ')
    await expect(createTaskFromSession(store, fakeDocStore(), 'sess-1', 'USER: hi', {})).rejects.toThrow(/empty title/)
    expect(listTasks(store)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/data-task-from-session.test.ts`
Expected: FAIL —「Cannot find module '../src/data/task-from-session'」。

- [ ] **Step 3: 写实现**

```ts
// src/data/task-from-session.ts
import type { Store } from '../db/store'
import { generateTaskTitle } from '../agent/index'
import { resolveBerthAgent } from './agent-config'
import { createTask, type CreateResult } from './tasks'
import { triggerTaskSummary } from './task-summary'
import type { DocStore } from './docstore'

/**
 * 根据一段会话对话 digest 一键建任务并关联到该会话：
 *   digest → berth agent 生成标题 → createTask → 关联会话 → 触发摘要(best-effort)。
 * transcript 的读取与抽取由调用方负责，本函数只吃已抽好的 digest，便于单测。
 */
export async function createTaskFromSession(
  store: Store,
  docStore: DocStore,
  sessionId: string,
  digest: string,
  opts: { projectId?: string } = {},
): Promise<CreateResult> {
  const text = digest.trim()
  if (!text) throw new Error('empty session content')

  const title = (await generateTaskTitle(text, resolveBerthAgent(store))).trim()
  if (!title) throw new Error('agent returned empty title')

  const result = await createTask(store, docStore, title, { projectId: opts.projectId, autoTitle: false })
  if (result.status !== 'created') return result

  // 自动关联：一个会话至多挂一个任务，先清旧边再加新边（与 /edge 同语义）。
  store.removeEdgesForSession(sessionId)
  store.addEdge(result.record.id, sessionId)
  if (opts.projectId) store.setAttach(sessionId, opts.projectId, 'confirmed')

  // 摘要 best-effort：此时会话已关联，digest provider 会把会话内容折进任务摘要。
  triggerTaskSummary(store, result.record.id)

  return result
}
```

> 实现时核对 `DocStore` / `Store` 的真实导出路径与类型名（`src/data/docstore.ts`、`src/db/store.ts`），若 `createTask` 未导出 `CreateResult` 则从 `./tasks` 补出 `export`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/data-task-from-session.test.ts`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/data/task-from-session.ts test/data-task-from-session.test.ts
git commit -m "feat(data): createTaskFromSession — agent-title a task from a session digest and link it"
```

---

## Task 2: 新 endpoint `POST /api/todos/from-session`

endpoint 负责：找会话 → 读 transcript → 抽 digest → 调编排函数 → 广播。

**Files:**
- Modify: `src/server/api.ts`（新增 handler；挨着既有 `/edge`（`:172`）或 `/todos`（`:632`））

已就绪的导入：`getStore`、`getCache`（`:3`）、`createTask`（`:9`，本任务不直接用）、`getDocStore`（`:13`）、`readTranscript`（`:32`）、`broadcastDataChanged`（文件内已用）。需要新增导入：`extractConversation`（`src/agent/transcript.ts:143`）、`createTaskFromSession`（Task 1）。

- [ ] **Step 1: 加导入**

在 api.ts 顶部 import 区补：

```ts
import { extractConversation } from '../agent/transcript'
import { createTaskFromSession } from '../data/task-from-session'
```

- [ ] **Step 2: 加 handler**

紧跟 `/edge` handler 之后插入：

```ts
// 一键据会话内容建任务并关联：读会话 transcript → 抽对话 digest → agent 生成标题 → 建任务 → 关联本会话。
api.post('/todos/from-session', async (req, res) => {
  const { sessionId, projectId } = req.body ?? {}
  if (typeof sessionId !== 'string' || sessionId === '')
    return res.status(400).json({ error: 'sessionId required' })
  const s = getCache().find((x) => x.sessionId === sessionId)
  if (!s || !s.contentSourcePath) return res.status(404).json({ error: 'no readable transcript' })
  const digest = extractConversation(readTranscript(s.contentSourcePath), 6000).trim()
  if (!digest) return res.status(422).json({ error: 'empty session content' })
  try {
    const store = getStore()
    const result = await createTaskFromSession(store, getDocStore(store), sessionId, digest, {
      projectId: typeof projectId === 'string' && projectId !== '' ? projectId : undefined,
    })
    broadcastDataChanged()
    res.json(result)
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 无输出；vitest 全绿（含 Task 1 的新测试）。

- [ ] **Step 4: 提交**

```bash
git add src/server/api.ts
git commit -m "feat(api): POST /todos/from-session — one-click create+link a task from session content"
```

---

## Task 3: 前端 api 方法 `createTaskFromSession`

**Files:**
- Modify: `web/src/lib/api.ts`（挨着 `edge`（`:141`）/ `createTask`（`:132`））

- [ ] **Step 1: 加方法**

在 `createTask` 附近加：

```ts
createTaskFromSession: (sessionId: string, projectId?: string) =>
  send('POST', '/api/todos/from-session', { sessionId, projectId }),
```

> 与同文件其它方法风格一致（`send(method, path, body)`）。无需单测——前端无 api 单测，靠 tsc + 手动验证。

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: 提交**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): api.createTaskFromSession client method"
```

---

## Task 4: 下拉入口 + 标签 loading + prop 接线

把 `onCreateTaskFromSession` 顺着 `onLinkTask` 同一条 prop 链（`SessionModule` → 中间分组组件 → `Row` → `TaskTag`）传下去；在 `TaskTag` 加顶部入口行与按钮 loading 态；在 `ProjectWorkspace` 接线。

**Files:**
- Modify: `web/src/components/workspace/SessionModule.tsx`
- Modify: `web/src/pages/ProjectWorkspace.tsx`

`onLinkTask` 当前在 SessionModule.tsx 的这些位置出现，`onCreateTaskFromSession` 要在**同样的每一处**并排加上：prop 类型 `:37 :132 :371 :525`，解构 `:33 :122 :351 :507`，透传 `:244(<TaskTag>) :473(<Row>) :594/:623(分组→Row)`。类型统一为 `(sessionId: string) => Promise<void> | void`。

- [ ] **Step 1: `TaskTag` 加 prop + loading state + 入口行**

`TaskTag` 解构加 `onCreateTaskFromSession`，类型块加同名 prop；组件内加 `const [creating, setCreating] = useState(false)`。

解构（`:30-38`）改为：

```tsx
function TaskTag({
  s,
  tasks,
  onLinkTask,
  onCreateTaskFromSession,
}: {
  s: SessionRow
  tasks?: SessionTaskOption[]
  onLinkTask: (sessionId: string, taskId: string | null) => Promise<void> | void
  onCreateTaskFromSession?: (sessionId: string) => Promise<void> | void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
```

在 `pick` 之后加点击处理（立即关闭 + 标签 loading）：

```tsx
  const createFromSession = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onCreateTaskFromSession) return
    close()
    setCreating(true)
    try {
      await onCreateTaskFromSession(s.id)
    } catch {
      // best-effort：失败就恢复，标签回到原关联/未关联；reload 不会带来新任务。
    } finally {
      setCreating(false)
    }
  }
```

触发按钮（`:58-76`）改为：`creating` 时显示 spinner + 「创建中…」并禁用；并把 `open` 时强制可见的样式也覆盖 `creating`：

```tsx
      <button
        ref={ref}
        type="button"
        disabled={creating}
        title={creating ? '正在根据会话内容创建任务…' : isLinked ? linked?.title ?? '已关联任务' : '关联到任务'}
        onClick={(e) => {
          e.stopPropagation()
          if (creating) return
          setOpen((v) => !v)
        }}
        className={cn(
          'flex max-w-[160px] flex-none items-center gap-1 rounded-md px-2 py-px text-[10.5px] transition-opacity',
          isLinked
            ? 'border border-brand/30 bg-brand/12 text-brand hover:bg-brand/20'
            : 'border border-dashed border-border text-text-dim opacity-0 hover:border-brand/45 hover:text-brand group-hover:opacity-100',
          (open || creating) && 'opacity-100',
        )}
      >
        {creating ? <Spinner size={10} className="flex-none" /> : <Link2 size={10} className="flex-none" />}
        <span className="truncate">{creating ? '创建中…' : isLinked ? linked?.title ?? '已关联任务' : '关联任务'}</span>
      </button>
```

popover 内，在 `<MenuLabel>关联任务</MenuLabel>`（`:87`）**之前**插入入口行（仅当 handler 存在）：

```tsx
          {onCreateTaskFromSession && (
            <>
              <MenuItem onClick={createFromSession}>
                <Sparkles size={13} className="flex-none text-brand" />
                <span className="min-w-0 truncate text-brand">找不到合适的任务？一键创建任务</span>
              </MenuItem>
              <div className="my-1 border-t border-border" />
            </>
          )}
          <MenuLabel>关联任务</MenuLabel>
```

> `Sparkles` 与 `Spinner` 均已 import（`SessionModule.tsx:2`、`:4`）。

- [ ] **Step 2: 透传 prop（4 处类型 + 4 处解构 + 3 处 JSX）**

在 `Row`、中间分组组件、`SessionModule` 三层，凡有 `onLinkTask` 的 prop 类型块、解构、子组件透传，都并排加 `onCreateTaskFromSession`：

- 类型块（`:132 :371 :525`）各加一行：
  ```ts
  onCreateTaskFromSession?: (sessionId: string) => Promise<void> | void
  ```
- 解构（`:122 :351 :507`）各加一行：`onCreateTaskFromSession,`
- JSX 透传：
  - `<TaskTag ... onLinkTask={onLinkTask} />`（`:244`）→ 加 `onCreateTaskFromSession={onCreateTaskFromSession}`
  - `<Row ... onLinkTask={onLinkTask}`（`:473`）→ 加 `onCreateTaskFromSession={onCreateTaskFromSession}`
  - 分组渲染 Row（`:594`、`:623`）两处 `onLinkTask={onLinkTask}` → 各加 `onCreateTaskFromSession={onCreateTaskFromSession}`

- [ ] **Step 3: `ProjectWorkspace` 接线**

在 `onLinkSessionTask`（`web/src/pages/ProjectWorkspace.tsx:255`）之后加 handler：

```ts
  const onCreateTaskFromSession = (sessionId: string) =>
    api.createTaskFromSession(sessionId, id).then(() => reload())
```

并在 `<SessionModule ... onLinkTask={onLinkSessionTask}`（`:587`）旁加：

```tsx
          onCreateTaskFromSession={onCreateTaskFromSession}
```

> `reload` 与项目 `id` 在该组件作用域已可用（`:39`、SessionModule 已用 `id`）。`onCreateTaskFromSession` 返回的 promise reject 时会被 `TaskTag.createFromSession` 的 catch 兜住，loading 收起。

- [ ] **Step 4: 类型检查 + 构建冒烟**

Run: `cd web && npx tsc --noEmit`
Expected: 无输出。
Run: `npm test`（仓库根）
Expected: 全绿（后端未受影响）。

- [ ] **Step 5: 手动验证**

Run: `npm start`（默认 `:7777`），打开一个有对话内容的会话所在项目页：
1. 悬停某会话行，点「关联任务」标签 → 下拉顶部出现「✨ 找不到合适的任务？一键创建任务」。
2. 点它 → 下拉立即关闭，标签变「创建中…」+ spinner。
3. 数秒后标签变成新生成的任务标题（已关联）；刷新任务列表能看到新任务，其摘要含会话内容。
4. 对一个空会话重复 → 标签短暂 loading 后恢复，不残留（服务端 422）。

- [ ] **Step 6: 提交**

```bash
git add web/src/components/workspace/SessionModule.tsx web/src/pages/ProjectWorkspace.tsx
git commit -m "feat(web): one-click 创建任务 entry in the related-task dropdown with tag loading"
```

---

## Self-review notes

- **Spec coverage**：入口行（Task 4 Step 1）、agent 据会话内容生成标题（Task 1 + Task 2 digest）、标题+摘要（Task 1 `triggerTaskSummary`，复用 digest provider）、自动关联+立即关闭+标签 loading（Task 4）、空内容 422 提示路径（Task 2 + Task 4 catch）——均有对应任务。
- **类型一致**：`createTaskFromSession(store, docStore, sessionId, digest, opts)` 在 Task 1 定义、Task 2 调用签名一致；前端 `onCreateTaskFromSession: (sessionId: string) => Promise<void> | void` 全链统一。
- **无 placeholder**：每个改动步骤都给了完整代码与确切位置/行号。
- **失败提示软项**：规格里「toast / 行内短提示」此处落为「catch 静默 + loading 收起 + reload 不带来新任务」。若仓库已有 toast 机制，可在 Task 4 Step 1 的 catch 内补一行调用；当前无强依赖，保持最小实现。
