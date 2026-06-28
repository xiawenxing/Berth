# Reliable session → task status flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent session launched from a task finishes, flow the task to the status the agent decided — reliably (engine-applied fallback), even when the agent botches/fakes its CLI call or no `berth` CLI is installed.

**Architecture:** Two complementary paths. **Path A:** the agent runs `berth task` with the *injected task id* (no title match) — hardened, best-effort. **Path B (the guarantee):** the agent emits a `BERTH_TASK_STATUS: <taskId> <status>` sentinel; on session settle Berth debounces ~5s, checks whether the status already moved (A worked) and, if not, parses the sentinel from the transcript and applies it itself. No decision → leave 进行中.

**Tech Stack:** TypeScript, Node 20 (better-sqlite3 ABI), vitest. Server in `src/server`, data layer in `src/data`, CLI in `src/cli-data.ts`.

> **Env note (worktree):** this worktree needs `node_modules` symlinked to the main checkout and **Node 20** on `PATH` (e.g. `nvm use 20`) or vitest fails with a fake ABI error. Run tests with `npx vitest run <file>`.

---

## File Structure

- **Create** `src/server/task-status-sentinel.ts` — pure: sentinel regex/parser + the reconcile decision function. No IO. Fully unit-tested.
- **Create** `src/server/task-status-flow.ts` — IO glue: `reconcileTaskStatusForSession` (reads transcript, writes store) + `startTaskStatusFlow` (subscribes to activity, debounces, calls reconcile).
- **Modify** `src/data/task-config.ts` — move `resolveStatusRoles` here (config-derived, pure) so the flow module doesn't import the heavy `pty-ws`.
- **Modify** `src/server/pty-ws.ts` — re-export `resolveStatusRoles` from its new home; pass the configured `statuses` into the manifest input.
- **Modify** `src/i18n.ts` — add `finishProtocol` lines to `ManifestStrings` (zh + en).
- **Modify** `src/agent/manifest.ts` — add `statuses?` to `TaskManifestInput`; render the finish-protocol section for task launches.
- **Modify** `src/server/index.ts` — call `startTaskStatusFlow(...)` once at server setup.
- **Modify** `src/cli-data.ts` — `--id` flag forces id-only task resolution.
- **Tests** `test/task-status-sentinel.test.ts`, `test/task-status-flow.test.ts`, extend `test/agent.test.ts` (manifest) and `test/cli-data.test.ts`.

---

## Task 1: Move `resolveStatusRoles` to task-config (decoupling)

**Files:**
- Modify: `src/data/task-config.ts` (add function near `getTaskFieldConfig`, line ~49)
- Modify: `src/server/pty-ws.ts:176-181` (remove local def, re-export)

- [ ] **Step 1: Move the function.** In `src/data/task-config.ts`, add (the body is copied verbatim from `pty-ws.ts:176-181`):

```typescript
/** Map the configured vocabulary to its pending / next-in-progress roles. */
export function resolveStatusRoles(cfg: TaskFieldConfig): { pending: string; inProgress: string | null } {
  const pending = cfg.defaultStatus
  const idx = cfg.statuses.indexOf(pending)
  const inProgress = idx >= 0 && idx + 1 < cfg.statuses.length ? cfg.statuses[idx + 1] : null
  return { pending, inProgress }
}
```

- [ ] **Step 2: Re-export from pty-ws.** In `src/server/pty-ws.ts`, delete the local `resolveStatusRoles` definition (lines 176-181) and add to the existing imports from `'../data/task-config'`:

```typescript
import { getTaskFieldConfig, resolveStatusRoles } from '../data/task-config'
```

Then re-export so existing importers/tests keep working:

```typescript
export { resolveStatusRoles } from '../data/task-config'
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the existing pty-ws / task tests.**

Run: `npx vitest run test/data-tasks.test.ts test/bind.test.ts`
Expected: PASS (no behavior change).

- [ ] **Step 5: Commit.**

```bash
git add src/data/task-config.ts src/server/pty-ws.ts
git commit -m "refactor(tasks): move resolveStatusRoles to task-config (decouple from pty-ws)"
```

---

## Task 2: Sentinel parser + reconcile decision (pure)

**Files:**
- Create: `src/server/task-status-sentinel.ts`
- Test: `test/task-status-sentinel.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/task-status-sentinel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseStatusSentinel, decideTaskStatusReconcile } from '../src/server/task-status-sentinel'

const VOCAB = ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消']

describe('parseStatusSentinel', () => {
  it('returns the status for a matching taskId + valid status', () => {
    const text = 'done.\nBERTH_TASK_STATUS: task-123 已完成\nthanks'
    expect(parseStatusSentinel(text, 'task-123', VOCAB)).toBe('已完成')
  })
  it('ignores a sentinel for a different taskId', () => {
    expect(parseStatusSentinel('BERTH_TASK_STATUS: other 已完成', 'task-123', VOCAB)).toBeNull()
  })
  it('ignores an unknown status', () => {
    expect(parseStatusSentinel('BERTH_TASK_STATUS: task-123 finished', 'task-123', VOCAB)).toBeNull()
  })
  it('takes the LAST valid sentinel when several appear', () => {
    const text = 'BERTH_TASK_STATUS: task-123 待验证\nBERTH_TASK_STATUS: task-123 已完成'
    expect(parseStatusSentinel(text, 'task-123', VOCAB)).toBe('已完成')
  })
  it('returns null when no sentinel is present', () => {
    expect(parseStatusSentinel('no marker here', 'task-123', VOCAB)).toBeNull()
  })
})

describe('decideTaskStatusReconcile', () => {
  it('no-ops when the task already moved off inProgress (Path A worked)', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '已完成', inProgress: '进行中', sentinelStatus: '阻塞' })).toBeNull()
  })
  it('applies the sentinel when still in progress', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '进行中', inProgress: '进行中', sentinelStatus: '已完成' })).toBe('已完成')
  })
  it('leaves in progress when there is no sentinel', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '进行中', inProgress: '进行中', sentinelStatus: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run test/task-status-sentinel.test.ts`
Expected: FAIL — `Failed to resolve import '../src/server/task-status-sentinel'`.

- [ ] **Step 3: Write the implementation.** Create `src/server/task-status-sentinel.ts`:

```typescript
/**
 * Path B detection: the agent declares its decided next status as a single sentinel line in its
 * final turn. We parse it from the transcript and (engine-side) apply it when the agent's own CLI
 * call (Path A) didn't already move the task. Pure — no IO.
 */
const SENTINEL_RE = /^[ \t>*-]*BERTH_TASK_STATUS:[ \t]+(\S+)[ \t]+(.+?)[ \t]*$/gm

/** Return the LAST sentinel whose taskId matches and whose status is in the vocab, else null. */
export function parseStatusSentinel(text: string, taskId: string, validStatuses: string[]): string | null {
  let found: string | null = null
  for (const m of text.matchAll(SENTINEL_RE)) {
    const id = m[1]
    const status = m[2].trim()
    if (id === taskId && validStatuses.includes(status)) found = status
  }
  return found
}

/**
 * Decision table run after the settle debounce.
 * - already off inProgress → Path A (the agent's CLI call) landed → no-op.
 * - still inProgress + a sentinel → apply it (Path B).
 * - still inProgress + no sentinel → leave it (no decision = no change).
 */
export function decideTaskStatusReconcile(args: {
  currentStatus: string | null
  inProgress: string | null
  sentinelStatus: string | null
}): string | null {
  const { currentStatus, inProgress, sentinelStatus } = args
  if (!inProgress || currentStatus !== inProgress) return null
  return sentinelStatus ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run test/task-status-sentinel.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/server/task-status-sentinel.ts test/task-status-sentinel.test.ts
git commit -m "feat(tasks): sentinel parser + reconcile decision for session→task status flow"
```

---

## Task 3: Reconcile glue — read transcript, write store

**Files:**
- Create: `src/server/task-status-flow.ts`
- Test: `test/task-status-flow.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/task-status-flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore } from '../src/db/store'
import { listTasks } from '../src/data/tasks'
import { reconcileTaskStatusForSession } from '../src/server/task-status-flow'

// Insert a task row directly (synchronous, no AI/docStore) — same shape the onboarding seed uses.
function seedTask(store: any, id: string, status: string): void {
  store.insertTask({
    id, title: 'do it', status, priority: 'P1',
    projectId: null, project: null, detailDoc: null, progress: null,
    updatedAt: 1000, syncedAt: 0, deleted: false,
  })
}

// Minimal claude jsonl transcript whose only assistant text carries a sentinel.
function writeClaudeTranscript(taskId: string, status: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-flow-'))
  const file = join(dir, 'sess.jsonl')
  const line = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: `done\nBERTH_TASK_STATUS: ${taskId} ${status}` }] },
  })
  writeFileSync(file, line + '\n')
  return file
}

const find = (store: any, id: string) => listTasks(store).find((x: any) => x.id === id)

describe('reconcileTaskStatusForSession', () => {
  it('applies the sentinel when the task is still in progress (Path B)', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-1', '进行中')
    store.addEdge('task-1', 'sess-1')
    const path = writeClaudeTranscript('task-1', '已完成')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-1',
      getSession: () => ({ sessionId: 'sess-1', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-1')?.status).toBe('已完成')
  })

  it('no-ops when the task already moved off 进行中 (Path A worked)', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-2', '已完成')
    store.addEdge('task-2', 'sess-2')
    const path = writeClaudeTranscript('task-2', '阻塞')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-2',
      getSession: () => ({ sessionId: 'sess-2', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-2')?.status).toBe('已完成')   // unchanged
  })

  it('leaves 进行中 when no sentinel is present', () => {
    const store = openStore(':memory:')
    seedTask(store, 'task-3', '进行中')
    store.addEdge('task-3', 'sess-3')
    const dir = mkdtempSync(join(tmpdir(), 'berth-flow-'))
    const path = join(dir, 's.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'no marker' }] } }) + '\n')
    reconcileTaskStatusForSession({
      store, sessionId: 'sess-3',
      getSession: () => ({ sessionId: 'sess-3', cli: 'claude', contentSourcePath: path }),
    })
    expect(find(store, 'task-3')?.status).toBe('进行中')
  })

  it('no-ops for a session with no bound task', () => {
    const store = openStore(':memory:')
    expect(() => reconcileTaskStatusForSession({
      store, sessionId: 'unbound',
      getSession: () => ({ sessionId: 'unbound', cli: 'claude', contentSourcePath: null }),
    })).not.toThrow()
  })
})
```

> Helpers confirmed to exist: `listTasks` (`src/data/tasks.ts:21`), `store.insertTask` (`src/db/store.ts`, used by the onboarding seed), `store.addEdge` / `store.todoKeyForSession` (`src/db/store.ts:213,227`). `updateTask` validates the status against config and throws on an invalid one — our `decided` status always comes from `cfg.statuses`, so it's safe.

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run test/task-status-flow.test.ts`
Expected: FAIL — cannot resolve `reconcileTaskStatusForSession`.

- [ ] **Step 3: Write the implementation.** Create `src/server/task-status-flow.ts`:

```typescript
import type { Store } from '../db/store'
import type { AgentCli } from '../data/types'
import { getTaskFieldConfig, resolveStatusRoles } from '../data/task-config'
import { listTasks, updateTask } from '../data/tasks'
import { parseTranscriptTurns } from './transcript-turns'
import { parseStatusSentinel, decideTaskStatusReconcile } from './task-status-sentinel'
import { subscribeActivity } from './pty-registry'
import { logDiag } from './diag'

export interface SessionRef { sessionId: string; cli: AgentCli; contentSourcePath: string | null }

/** Read the latest agent turn's text from a session transcript (empty string if none). */
function latestAgentText(cli: AgentCli, contentSourcePath: string | null): string {
  const turns = parseTranscriptTurns(cli, contentSourcePath)
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'agent') return turns[i].text
  return ''
}

/**
 * Path B reconcile for one session. Looks up the bound task; if it's still in the in-progress role,
 * parses the sentinel from the latest agent turn and applies the agent's decided status. Idempotent.
 */
export function reconcileTaskStatusForSession(args: {
  store: Store
  sessionId: string
  getSession: (sessionId: string) => SessionRef | null
  now?: () => number
}): void {
  const { store, sessionId, getSession } = args
  const todoKey = store.todoKeyForSession(sessionId)
  if (!todoKey) return
  const task = listTasks(store).find(t => t.id === todoKey)
  if (!task) return

  const cfg = getTaskFieldConfig(store)
  const { inProgress } = resolveStatusRoles(cfg)
  // Fast path: if it already moved off in-progress, Path A worked — don't even read the transcript.
  if (!inProgress || task.status !== inProgress) return

  const session = getSession(sessionId)
  if (!session?.contentSourcePath) return
  const sentinelStatus = parseStatusSentinel(latestAgentText(session.cli, session.contentSourcePath), todoKey, cfg.statuses)
  const decided = decideTaskStatusReconcile({ currentStatus: task.status, inProgress, sentinelStatus })
  if (decided && decided !== task.status) {
    updateTask(store, todoKey, { status: decided }, args.now ?? Date.now)
    logDiag({ category: 'reconcile', event: 'task_status_flow', sessionId, todoKey, status: decided } as any)
  }
}

/**
 * Subscribe to the activity FSM. When a bound session settles, debounce, then reconcile. The debounce
 * gives Path A (the agent's own `berth task` call) time to land before the engine fallback runs.
 */
export function startTaskStatusFlow(args: {
  store: Store
  getSession: (sessionId: string) => SessionRef | null
  debounceMs?: number
}): () => void {
  const { store, getSession } = args
  const debounceMs = args.debounceMs ?? 5000
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const unsub = subscribeActivity(e => {
    if (e.kind !== 'state') return
    const sid = e.sessionId
    if (e.state === 'running') { const x = timers.get(sid); if (x) { clearTimeout(x); timers.delete(sid) } ; return }
    if (e.state !== 'settled' && e.state !== 'exited') return
    const prev = timers.get(sid); if (prev) clearTimeout(prev)
    timers.set(sid, setTimeout(() => {
      timers.delete(sid)
      try { reconcileTaskStatusForSession({ store, sessionId: sid, getSession }) } catch (err: any) {
        logDiag({ category: 'reconcile', event: 'task_status_flow_error', sessionId: sid, level: 'warn', message: String(err?.message ?? err) } as any)
      }
    }, debounceMs))
  })
  return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); unsub() }
}
```

> If `logDiag`'s field schema rejects the extra keys, drop the `as any` payloads to the nearest valid shape (grep `logDiag` usages in `src/server/reconcile.ts` for the accepted fields). The reconcile must never throw because of logging.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run test/task-status-flow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/server/task-status-flow.ts test/task-status-flow.test.ts
git commit -m "feat(tasks): engine-side reconcile + settle-debounce subscriber (Path B)"
```

---

## Task 4: Wire `startTaskStatusFlow` into server startup

**Files:**
- Modify: `src/server/index.ts` (near the `createStatusWss` wiring)

- [ ] **Step 1: Add the wiring.** In `src/server/index.ts`, add imports:

```typescript
import { startTaskStatusFlow } from './task-status-flow'
import { getStore } from './store-singleton'
import { getCache } from './store-singleton'
```

(Use the existing `getStore`/`getCache` imports if already present — don't duplicate.) Then, in the server setup function right after the status WSS is created, add:

```typescript
// Path B of the session→task status flow: on settle, debounce, then apply the agent's decision.
startTaskStatusFlow({
  store: getStore(),
  getSession: (sid) => {
    const s = getCache().find(x => x.sessionId === sid)
    return s ? { sessionId: s.sessionId, cli: s.cli, contentSourcePath: s.contentSourcePath ?? null } : null
  },
})
```

> Confirm `getStore` is the singleton accessor exported by `store-singleton.ts` (grep `export function getStore`). `LogicalSession` (the `getCache()` element) has `sessionId`, `cli`, `contentSourcePath` — verify with `grep -n "interface LogicalSession" src`.

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full server test suite (smoke).**

Run: `npx vitest run test/bind.test.ts test/activity.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/server/index.ts
git commit -m "feat(tasks): wire startTaskStatusFlow at server startup"
```

---

## Task 5: Manifest finish-protocol (Path A commands + Path B sentinel spec)

**Files:**
- Modify: `src/i18n.ts` (ManifestStrings interface + zh + en, near lines 24-92)
- Modify: `src/agent/manifest.ts` (TaskManifestInput + task render block, lines 8-18, 64-81)
- Modify: `src/server/pty-ws.ts` (pass `statuses` into the enriched manifest input, ~line 436)
- Test: extend `test/agent.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `test/agent.test.ts` (adapt the import/helpers to the file's existing style; grep its top for how it imports `buildManifest`):

```typescript
import { describe, it, expect } from 'vitest'
import { buildManifest } from '../src/agent/manifest'

describe('manifest finish-protocol', () => {
  const base = {
    kind: 'task' as const, projectName: 'P', docsRoot: '/tmp/docs',
    todo: { id: 'task-xyz', title: 'T', status: '进行中', priority: 'P1', detailDoc: null, projectId: null } as any,
    statuses: ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消'],
  }
  it('includes the task id, the sentinel line spec, and an id-filled command', () => {
    const { text } = buildManifest(base)
    expect(text).toContain('task-xyz')
    expect(text).toContain('BERTH_TASK_STATUS: task-xyz')
    expect(text).toContain('berth task done task-xyz')
  })
  it('omits the finish-protocol for a project launch', () => {
    const { text } = buildManifest({
      kind: 'project', projectName: 'P', docsRoot: '/tmp/docs', projectTodos: [],
    } as any)
    expect(text).not.toContain('BERTH_TASK_STATUS')
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run test/agent.test.ts -t "finish-protocol"`
Expected: FAIL — text does not contain the sentinel/command.

- [ ] **Step 3: Add the i18n strings.** In `src/i18n.ts`, add to the `ManifestStrings` interface (near line 38):

```typescript
  finishProtocol: (taskId: string, statuses: string[]) => string[]
```

In the **zh** ManifestStrings object (near line 70, before `footer`), add:

```typescript
    finishProtocol: (taskId, statuses) => [
      '',
      '## 收尾：声明任务下一步状态',
      '完成本任务的工作后，判断它应进入的状态，并用下面两种方式各做一次（双保险）：',
      `1. 若可用 berth CLI：运行  berth task done ${taskId}  （或  berth task status ${taskId} <状态>）`,
      `2. 在你的最后一条消息里，单独占一行输出：  BERTH_TASK_STATUS: ${taskId} <状态>`,
      `可选状态： ${statuses.join(' / ')}`,
      '若你判断任务未完成（仍需继续/被阻塞/待人工验证），就声明对应状态；不要谎报已完成。',
    ],
```

In the **en** ManifestStrings object (near line 92, before `footer`), add:

```typescript
    finishProtocol: (taskId, statuses) => [
      '',
      '## Wrap-up: declare the task\'s next status',
      'After finishing this task, judge the status it should move to, and do BOTH of the following (double safety):',
      `1. If the berth CLI is available, run:  berth task done ${taskId}  (or  berth task status ${taskId} <status>)`,
      `2. In your final message, output on its own line:  BERTH_TASK_STATUS: ${taskId} <status>`,
      `Allowed statuses: ${statuses.join(' / ')}`,
      'If the task is not actually done (still going / blocked / needs human verification), declare that status — do not falsely claim completion.',
    ],
```

- [ ] **Step 4: Add `statuses` to the manifest input + render it.** In `src/agent/manifest.ts`, add to `TaskManifestInput` (after line 17):

```typescript
  statuses?: string[]          // configured status vocab; drives the finish-protocol block
```

Then in the task render block, after the detailDoc lines (after line 80, still inside `if (incl.task)`), add:

```typescript
      if (todo.id && input.statuses && input.statuses.length) {
        for (const line of m.finishProtocol(todo.id, input.statuses)) lines.push(line)
      }
```

- [ ] **Step 5: Pass `statuses` from pty-ws.** In `src/server/pty-ws.ts`, at the `enriched` construction (~line 436), add `statuses` (config already imported via `getTaskFieldConfig`):

```typescript
    const enriched = {
      ...enrichManifestForContext(plan.manifestInput, ctxInjection),
      include: { project: gates.project, task: gates.task },
      statuses: getTaskFieldConfig(store).statuses,
    }
```

> `statuses` on a project-kind input is harmless (the manifest only reads it under `kind === 'task'`). If TS complains about the extra property on the union, widen the `enriched` type or set it only for task kind.

- [ ] **Step 6: Run the manifest tests.**

Run: `npx vitest run test/agent.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 7: Typecheck + commit.**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/i18n.ts src/agent/manifest.ts src/server/pty-ws.ts test/agent.test.ts
git commit -m "feat(tasks): inject finish-protocol (id-filled commands + sentinel spec) into manifest"
```

---

## Task 6: CLI `--id` resolution guard (Path A hardening)

**Files:**
- Modify: `src/cli-data.ts` (`selectTask` line 27-41; `resolveOne` line 127-134; task command flag parse)
- Test: extend `test/cli-data.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `test/cli-data.test.ts` (match the file's existing import of `selectTask`; grep its top):

```typescript
import { describe, it, expect } from 'vitest'
import { selectTask } from '../src/cli-data'

describe('selectTask id-only mode', () => {
  const tasks = [
    { id: 'abc-123', title: '处理会话', status: null, priority: null, project: null },
    { id: 'def-456', title: '会话导入', status: null, priority: null, project: null },
  ]
  it('matches many by title substring in default mode', () => {
    expect(selectTask(tasks as any, '会话').length).toBe(2)
  })
  it('with idOnly, matches only exact id (never title)', () => {
    expect(selectTask(tasks as any, '会话', { idOnly: true }).length).toBe(0)
    expect(selectTask(tasks as any, 'abc-123', { idOnly: true }).map(t => t.id)).toEqual(['abc-123'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run test/cli-data.test.ts -t "id-only"`
Expected: FAIL — `selectTask` takes no options / title still matches.

- [ ] **Step 3: Add the `idOnly` option.** In `src/cli-data.ts`, change `selectTask` (lines 27-41) to accept an options arg and short-circuit on id:

```typescript
export function selectTask(tasks: TaskLite[], q: string, opts?: { idOnly?: boolean }): TaskLite[] {
  const exact = tasks.find(t => t.id === q)
  if (exact) return [exact]
  if (opts?.idOnly) {
    const pfx = q.length >= 6 ? tasks.filter(t => t.id.startsWith(q)) : []
    return pfx
  }
  if (q.length >= 6) { const pfx = tasks.filter(t => t.id.startsWith(q)); if (pfx.length) return pfx }
  const lc = q.toLowerCase()
  return tasks.filter(t => (t.title || '').toLowerCase().includes(lc))
}
```

> Keep the existing prefix/title behavior for the non-`idOnly` branch identical to lines 33-40 — copy them verbatim from the current file; the snippet above shows the intended shape, but match the real current logic exactly.

- [ ] **Step 4: Thread `--id` through `resolveOne` and the task command.** Update `resolveOne` (line 127):

```typescript
async function resolveOne(base: string, query: string, opts?: { idOnly?: boolean }): Promise<TaskLite> {
  const matches = selectTask(await getTasks(base), query, opts)
  if (matches.length === 0) throw new Error(`未找到匹配的任务：「${query}」`)
  if (matches.length > 1) throw new Error(`「${query}」匹配到多个任务，请用更精确的标题或 id：\n` + formatTaskTable(matches))
  return matches[0]
}
```

Then in the task command body, read `flags.id` (boolean) and pass `{ idOnly: !!flags.id }` to the `resolveOne` calls in the `done`, `status`, and `set` cases (lines 192, 202, 208). Also add `--id` to the usage text (line 150 block).

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npx vitest run test/cli-data.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Verify loud failures (spec §3).** Confirm errors already surface non-zero: `resolveOne` throws on ambiguous/no match, and `bin/berth.mjs` wraps `runCli` in `.catch(e => { console.error(e); process.exit(1) })`. So an honest agent sees a non-zero exit + stderr today — no new code needed. Just sanity-run:

Run: `node bin/berth.mjs task done 会话 2>&1; echo "exit=$?"`
Expected: prints "匹配到多个任务" (or "Berth 服务未运行" if no server) and `exit=1` (non-zero). No change required if this holds.

- [ ] **Step 7: Typecheck + commit.**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/cli-data.ts test/cli-data.test.ts
git commit -m "feat(cli): --id guard forces id-only task resolution (no title mismatch)"
```

---

## Task 7: Update injected finish commands to use `--id`; full-suite green; docs

**Files:**
- Modify: `src/i18n.ts` (finishProtocol commands → `--id`)
- Modify: `docs/ARCHITECTURE.md` (note the new flow)

- [ ] **Step 1: Make the injected commands id-safe.** In both `finishProtocol` definitions in `src/i18n.ts`, change the command examples to use the new guard:
  - zh: `berth task done --id ${taskId}` and `berth task status --id ${taskId} <状态>`
  - en: `berth task done --id ${taskId}` and `berth task status --id ${taskId} <status>`

  Update the matching assertion in `test/agent.test.ts` (`berth task done task-xyz` → `berth task done --id task-xyz`).

- [ ] **Step 2: Run the manifest + cli tests.**

Run: `npx vitest run test/agent.test.ts test/cli-data.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the FULL suite.**

Run: `npx vitest run`
Expected: PASS (no regressions). Note: `*.live.test.ts` stay skipped without `BERTH_LIVE=1`.

- [ ] **Step 4: Document the flow.** In `docs/ARCHITECTURE.md`, add a short subsection (near the launch / reconcile docs) describing: launch advances 待办→进行中 (`advanceTodoOnLaunch`); on settle a ~5s debounce runs `reconcileTaskStatusForSession`; Path A (id-injected `berth task --id`) vs Path B (`BERTH_TASK_STATUS` sentinel); no-decision leaves 进行中; CLI-availability on app-launched machines is a deferred follow-up.

- [ ] **Step 5: Commit.**

```bash
git add src/i18n.ts test/agent.test.ts docs/ARCHITECTURE.md
git commit -m "feat(tasks): id-safe finish commands + document session→task status flow"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run` green.
- [ ] Manual smoke (optional, needs a running server on Node 20): launch a task session, let it settle without the agent moving the task, confirm a `BERTH_TASK_STATUS: <id> 已完成` in the agent's final message flips the board to 已完成 after ~5s; and that a session with no decision leaves the task at 进行中.

## Notes / deferred

- **CLI availability on app-launched machines** (prepend Berth's bin to the agent PTY `PATH`; set `PORT`/`HOST` in the agent env) is out of scope — Path B already makes correctness CLI-independent. Track separately.
- **Honest prose narration** is unsolvable at the model level; the store-level guarantee (id-injection + reconcile) is the answer.
