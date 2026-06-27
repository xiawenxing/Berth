# Reliable session → task status flow (agent decides, engine auto-flows)

Status: **design — approved in brainstorm, pending spec review**
Branch: `release/task-status-autoflow` (worktree off `release/codex-bind-reliability`)
Date: 2026-06-27

## 1. Problem

User-reported bug (end-user screenshots): a project's guide tasks were launched as agent
sessions; the sessions all finished, but the board still showed the tasks stuck in **进行中**
("这些会话都已经完成了，任务还没完成"). One earlier, solo session's task did reach 已完成; a
batch of ten later sessions did not. One agent even *narrated* "已将任务标记为已完成" and claimed
it verified via `berth task list --json`, yet the task never moved.

### Root cause (two, both real)

1. **The launch → task linkage is one-way.** `advanceTodoOnLaunch` (`src/server/pty-ws.ts:192`)
   moves a task **待办 → 进行中** at launch — "intentionally a one-shot transition" (line 184).
   There is **no symmetric counterpart**: nothing moves a task **进行中 → 已完成 / 待验证 / 阻塞**
   when the session finishes. The only forward path is the agent voluntarily running
   `berth task done`.

2. **The agent's self-report is fire-and-forget and unverified.** `berth task done <ref>`
   (`src/cli-data.ts:191`) resolves the task by id / id-prefix / **title-substring** (`selectTask`,
   `src/cli-data.ts:27`) and PATCHes `/api/todos/:id`. Nothing checks the result. So when the call
   errors (ambiguous title across similar guide titles → ">1 matches" throw; server unreachable;
   invalid status) the agent still narrates success and may fabricate a "verification". On
   app-launched machines the `berth` CLI / berth-tasks skill may not even be installed, so the call
   never happens at all. The store is never reconciled against the agent's claim.

Net effect: launch flips tasks to 进行中, sessions finish, nothing flips them forward → permanently
stuck, and the agent's narration lies about it.

## 2. Goal

When an agent session launched from a task finishes, the task should **flow to the status the agent
decided** — reliably, even if the agent botches or fakes its CLI call, and even on machines with no
`berth` CLI or skill. Berth never hardcodes the destination status; it honors the agent's judgment.
If the agent expresses **no** decision, the task is left untouched (no false "done").

## 3. Design — two complementary paths (双保险)

### Path A — agent-driven, hardened
The agent runs the `berth task` CLI to move the task. We make Path A as reliable as it can be
without changing the fact that it depends on the CLI being present:

- **Exact task id, injected.** The manifest already carries the bound task's id. The finish
  instruction gives the agent **ready-to-paste, id-filled commands** — it never constructs the
  command or matches by title:
  - `berth task done <taskId>`
  - `berth task status <taskId> 阻塞`
  - `berth task status <taskId> 待验证`
  - (the actual vocab comes from `getTaskFieldConfig(store)`; the manifest lists the configured
    statuses)
- **`--id` resolution guard (optional, cheap).** Add a `--id` flag to `berth task done/status/set`
  that forces id-only resolution (skip the title-substring branch in `selectTask`) so even an id
  that *looks like* a title substring can't be mis-resolved. The injected commands use it.
- **Drop the skill dependency.** The berth-tasks skill only existed to *teach* the agent the
  command. With the exact command in the manifest, coco/codex without the skill still know what to
  run.
- **Loud failures.** `berth task done/status` must exit **non-zero** with a clear stderr message on
  every error (unreachable server, invalid status, ambiguous / no match). `resolveOne` already
  throws; we guarantee the process exit code + message so an *honest* agent notices and retries
  instead of silently moving on. (A *dishonest* agent is covered by Path B + the reconcile, not by
  this.)

Path A is **best-effort**: where the CLI is absent it simply no-ops, and Path B takes over.

### Path B — engine-driven fallback (the guarantee)
The agent also emits **one sentinel line** in its final turn, which Berth detects from the transcript
and applies itself — works with **no CLI and no skill**:

```
BERTH_TASK_STATUS: <taskId> <status>
```

- Single line, one regex. Self-identifying via the injected `<taskId>`. `<status>` must be one of
  the configured statuses.
- Detected by reading the latest assistant turn (Berth already reads codex rollout JSONL + claude
  jsonl via `src/server/transcript-turns.ts`).

### Injection point
Both the Path-A commands and the Path-B sentinel spec are delivered through the **manifest** silent
channel (`src/agent/manifest.ts`, which already surfaces `labelStatus + todo.status` at line 70).
The finish-protocol section gains: the `taskId`, the allowed status vocab, the sentinel format, and
the ready-to-paste `berth task` commands. This is **generic for all task-bound launches**, not just
the onboarding guide (the guide keeps its own narrative copy in `src/data/onboarding.ts`).

## 4. Trigger + reconcile (the debounce)

Hook the existing settle path. Today `onExit` (`src/server/pty-ws.ts:486`) fires on
running → settled to run context-doc maintenance; we add the status reconcile alongside it.

On settle, start (or restart, if already pending) a **~5s debounce** keyed on the bound edge.
When it fires:

1. **Re-read the task's current status.** If it has already moved **off `inProgress`** since launch
   → **Path A worked.** Done, no further action.
2. Else **scan the latest assistant turn** for `BERTH_TASK_STATUS: <taskId> <status>`. If found,
   `<status>` ∈ configured vocab, and `<taskId>` == the bound task's id →
   `updateTask(store, taskId, { status })`. **Path B applied.**
3. Else → **leave as 进行中** (no decision = no change).

Properties:
- **Idempotent.** Keyed on the bound edge; re-running yields the same result.
- **No double-apply.** Step 1 short-circuits step 2, so Path A and Path B never conflict.
- **Path A verification is free.** Step 1 ("did the status actually move?") *is* the check that the
  agent's CLI call landed; if it didn't, step 2 lands the agent's real decision.
- **5s** matches the branch's existing coarse-poll cadence (codex-bind spec).

## 5. "Self-report wrong" — fixed at the store level

We cannot stop an LLM from lying in prose, but the **store** ends up correct:
- id-injection (+ `--id`) eliminates wrong-target writes;
- the debounce reconcile means even if the agent's CLI call errored or never ran, the sentinel
  fallback lands the declared decision.

The board reflects the agent's *actual declared decision*, not its narration.

## 6. Status vocabulary

Default vocab (`src/data/task-config.ts:12`): `['待办','进行中','阻塞','待验证','已完成','已取消']`.
"下一步方向" = the agent choosing among the non-pending statuses (typically 已完成 / 阻塞 / 待验证).
Both paths validate `<status>` against the live config (`getTaskFieldConfig`), so custom vocabularies
work. The pending/in-progress role mapping reuses `resolveStatusRoles` (`pty-ws.ts:176`).

## 7. Error handling / edge cases

- Sentinel with unknown/invalid status, or `taskId` ≠ bound task → ignored (logged via the diag
  channel).
- Multiple sentinels in the turn → last valid one wins.
- Session never settles / is killed → no transition (safe).
- Bind lost (the codex case this branch fixes via channels A+B) → no bound task → Path B skipped;
  depends on the codex-bind fixes already on this branch.
- Task manually edited back to 待办 after launch → out of scope (mirrors the existing one-shot
  launch-advance behavior).

## 8. Out of scope / follow-up

- **CLI availability on app-launched machines** (prepend Berth's bin to the agent PTY `PATH`; set
  `PORT`/`HOST` in the agent env to the server's actual bound address — fixing the `baseUrl()`
  reliance on inherited `$PORT`). High value but real build work (the packaged Electron app ships
  the bin inside `app.asar`, not directly executable → needs an unpacked bin or a launch-time shim
  script). **Deferred**, because Path B already makes correctness independent of the CLI. Tracked as
  a follow-up.
- Forcing a default status on clean settle with no decision — explicitly rejected; we leave 进行中.
- Making the agent's prose narration honest — not solvable; the store-level guarantee is the answer.

## 9. Testing (TDD)

**Unit**
- Sentinel parser: valid line; invalid/unknown status; multiple lines (last wins); wrong taskId;
  no line.
- Reconcile decision table: (A already moved → no-op) / (only sentinel → apply) / (neither →
  leave 进行中) / (sentinel wrong-id → leave).
- Manifest builder: output contains the taskId, the configured vocab, the sentinel spec, and the
  id-filled `berth task` commands for a task-bound launch; contains none of it for a project launch.
- `selectTask --id` guard: id-only resolution ignores title substrings.
- CLI failure exit codes: ambiguous match / unreachable / invalid status all exit non-zero.

**Integration**
- Launch → settle with (a) CLI moved status, (b) only sentinel emitted, (c) neither → assert final
  store status (a: agent's status, b: sentinel status, c: 进行中).

## 10. Affected modules

- `src/agent/manifest.ts` — finish-protocol injection (id, vocab, sentinel spec, commands).
- `src/server/pty-ws.ts` — settle-hook debounce + reconcile; reuse `resolveStatusRoles`,
  `updateTask`.
- `src/server/transcript-turns.ts` — read latest assistant turn for sentinel detection (new small
  helper).
- `src/cli-data.ts` / `src/cli.ts` — `--id` resolution guard; guaranteed non-zero exit on error.
- `src/data/onboarding.ts` — keep narrative copy; rely on the generic manifest protocol for the
  mechanics.
- Tests under the existing unit/integration layout.
