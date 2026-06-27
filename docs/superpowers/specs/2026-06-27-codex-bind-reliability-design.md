# Codex task↔session bind reliability — design

> Status: design draft (probe验证完成,未写代码)
> Branch: `release/codex-bind-reliability`
> Related: launch/first-turn chain (see ARCHITECTURE.md gotcha #6/#12/#14/#15, `reconcile.ts`,
> `launch-ready.ts`, `launchingOverlay` in `api.ts`).

## Problem

A codex session launched **from a task** can lose its task binding: user launches from a task,
chats for a long time, Berth is killed (SIGKILL/crash), and on restart the session is no longer
under the task — the link is gone.

claude/coco are **not** affected: they pre-mint `--session-id`, so `pty-ws.ts` writes the
`edge(todoKey, sessionId)` row **synchronously at launch** (`bound=1`). That edge is on disk in
SQLite and survives any restart.

## Root cause (codex only)

codex has no `--session-id`; at launch `sessionId` is unknown, so **no edge is written**. The real
bind happens later via **reconcile** (`reconcile.ts`), which is driven only by:

1. `watchCodexFirstTurn` (`launch-ready.ts`) — polls `refresh()` every 500ms for **only 40s**
   (`CODEX_TURN_WATCH_TIMEOUT_MS`), waiting for the rollout `task_started` signal.
2. Explicit `refresh()` calls (manual 同步会话, attach/edge/pin/folder ops).

`/api/sessions` polling does **not** call `refresh()` — it reads `getCache()`. So merely keeping the
session list open never drives reconcile.

Failure window:
- First turn doesn't deterministically start within 40s (slow cold start, or first-turn auto-submit
  miss — gotcha #15) → the watcher times out **without binding**. No periodic refresh exists, so the
  edge is never written for the rest of the session.
- During the long chat the session still appears under the task **only via `launchingOverlay`** — an
  in-memory synthesis gated on a **live PTY** (`hasLivePty`), using `intent.todoKey`. It is NOT a
  persisted edge.
- Berth killed → PTY dies (PTYs are children of the server). On restart the overlay can't synthesize
  the row (no live PTY). Startup `refresh()` runs reconcile again — the recovery chance — but it
  re-matches by **"newest codex session in cwd, updatedAt ≥ createdAt"**, which mis-binds or fails
  when there are **multiple codex sessions in the same cwd**, or the recorded cwd diverges. That
  residual mismatch is the **intermittent permanent loss**.

`deleteLaunchIntent` is defined but never called, so the `launch_intent` row (carrying `todo_key`)
persists — that's why most cases self-heal on restart and the loss is only "偶现".

## Probe results (2026-06-27, real codex 0.142.0)

Ran `codex exec --profile <capture> --dangerously-bypass-hook-trust` with a SessionStart hook that
dumps stdin/env. Findings:

**1. codex SessionStart hook stdin envelope carries the real session id:**

```json
{
  "session_id": "019f076d-94d2-7570-b442-82dfc6604c20",
  "transcript_path": ".../sessions/2026/06/27/rollout-...-019f076d-....jsonl",
  "cwd": ".../codex-probe/cwd",
  "hook_event_name": "SessionStart",
  "permission_mode": "bypassPermissions",
  "source": "startup"
}
```

→ Plan A (hook callback) is viable: the hook gets `session_id` + `cwd` + `transcript_path` directly.
Berth already injects env into the hook (`BERTH_CONTEXT_FILE`), so it can also inject
`BERTH_LAUNCH_TOKEN` → the hook reports `{launchToken, session_id, cwd}` for **exact** correlation.

**2. rollout file first line is `session_meta` (hook-independent, always written):**

```json
{"type":"session_meta","payload":{"session_id":"…","cwd":"…","timestamp":"…","originator":"…"}}
```

Written at session start, before `task_started`. → Plan B (fs.watch) is viable as the
hook-independent fallback.

**3. codex `notify` is NOT a usable carrier:** `config.toml` has
`notify = ["…SkyComputerUseClient", "turn-ended"]` — a **single** program slot already occupied by
Computer Use, and the event is `turn-ended`, not session-start. Hijacking it would break Computer Use
and wouldn't fire at startup anyway. (This is likely the "flux 收到通知" channel the owner recalled —
but it's turn-ended + occupied, so unsuitable.)

## Design — two complementary channels, whichever fires first writes the durable edge

Goal: make codex bind **at session start, durably (edge on disk), exactly** — like claude/coco —
instead of an eventually-consistent 40s-window reconcile.

### Channel A — SessionStart hook callback (precise, but optional)
- Inject `BERTH_LAUNCH_TOKEN=<intent.id or fresh token>` into the codex launch env (next to the
  existing `BERTH_CONTEXT_FILE`).
- Extend the generated `berth-launch.config.toml` SessionStart hook command: besides `cat`-ing the
  context, parse stdin's `session_id` and emit `{launchToken, sessionId, cwd}` to a berth-watched
  drop (`$BERTH_HOME/launch-callbacks/<launchToken>.json`) — or POST to a localhost berth endpoint.
- Berth resolves `launchToken → intent` **exactly** (no cwd/time guessing), writes
  `edge(intent.todoKey, sessionId)` + `setAttach` + `bindIntent` + `rekeyPty`. Zero ambiguity even
  with multiple codex sessions in the same cwd.
- Degrades silently if `hooks=false`, old codex without `--dangerously-bypass-hook-trust`, or trust
  fails → Channel B covers it.

### Channel B — fs.watch the codex sessions tree (guaranteed, hook-independent)
- Watch `~/.codex/sessions/**` for new `rollout-*.jsonl` creation.
- On create, read the first line `session_meta` → `{session_id, cwd, timestamp}`.
- Correlate to a pending intent by `normPath(cwd) == intent.cwd` AND
  `session_meta.timestamp ∈ [intent.createdAt, intent.createdAt + Δ]`. Because the create event fires
  within ms of launch, the time window is tiny → mis-bind essentially eliminated vs today's
  "newest in cwd". Then write the same edge.
- Always fires (codex must write the rollout), so this alone closes the data-loss hole even if every
  hook path is disabled.

### Shared invariants
- Both channels call the **same idempotent bind** (`addEdge` is PK-guarded; `bindIntent` no-ops if
  already bound). Whichever wins first, the other is harmless.
- Once either writes the edge, the binding is on disk → **survives kill+restart** with no overlay and
  no re-matching. This is the actual fix.
- Old `watchCodexFirstTurn`/reconcile stays as a **last-ditch** fallback (demoted from critical
  path), and startup `refresh()` keeps running it for any pre-existing unbound intents.

## claude/coco bind reliability (contrast) — the opposite failure, P2

claude/coco are the **most** reliable of the three and need none of the above: `--session-id <uuid>`
(no `--resume`) makes claude write `<id>.jsonl` at exactly that id and coco honor the pre-minted id
(`launch.ts:149/203`, gotcha #6), and `pty-ws.ts:447-448` writes `edge(todoKey, sessionId)`
**synchronously to SQLite at launch** (`bound=1`). Once a turn runs (jsonl exists), the bind is
correct and durable across restart — no window, no reconcile, no cwd guessing.

Their residual risk is the **inverse** of codex: the edge is written **optimistically, before the
session is confirmed on disk**. If the launch never produces a jsonl (trust-dialog swallow gotcha #11,
first-turn auto-submit miss gotcha #15, binary failure, immediate kill), the edge **dangles** — points
at a session id that never materialized. `/api/todos` (`api.ts:690`) returns
`sessions: edgesMap.get(t.id) ?? []` **unfiltered** against on-disk existence, so the phantom id stays
in the task's `sessions[]`.

Impact is **benign, not data-loss**: `/api/sessions` has no row for that id → the frontend can't
render it → invisible cruft, not a wrong visible session.

Fallback status:
- **Source-side prevention exists and works**: trust pre-seed (`pty/trust.ts`), first-turn nudge
  (`launch-firstturn.ts`) — these stop most "no jsonl" cases at the source.
- **No dangling-edge cleanup**: `removeEdgesForSession` fires only on explicit detach/delete/hide
  (`api.ts:260/500/514`); the "sweep a dead orphan" `deleteLaunchIntent` (`store.ts:313`) is **defined
  but never wired**.

**P2 fix (optional, fold into this branch or backlog):** wire `deleteLaunchIntent` into an orphan
sweep — for a `bound=1` launch whose **pty is dead** AND **sessionId has no jsonl** AND the **intent is
older than a grace period** (avoid deleting a session still in its boot window), drop both the intent
and its dangling edge. Keep the grace period generous so a slow-but-real launch is never swept.

## Open questions / to verify before coding
- Exact emit mechanism for Channel A: file-drop (berth fs.watch on `launch-callbacks/`) vs localhost
  HTTP. File-drop avoids needing the hook to know berth's port; lean file-drop.
- `session_meta.timestamp` is the session's own start time — confirm its clock vs `intent.createdAt`
  (both wall-clock seconds) and pick Δ generously (e.g. 120s) but bounded.
- fs.watch on a deep dated tree (`sessions/YYYY/MM/DD/`) — recursive watch portability on macOS
  (`fs.watch(recursive:true)` is supported on darwin) vs a small poll of the newest day dir.
- Whether to also key Channel B precisely by injecting a berth marker codex records in `session_meta`
  (none available today) — if not, A provides the precision, B provides the guarantee.

## Test plan
- Unit: pure correlation fns (launchToken→intent; session_meta+timewindow→intent); idempotent
  double-bind (A and B both fire) writes one edge.
- Unit: bind-at-start path writes edge before any `task_started`, so a simulated kill (drop pty +
  re-`refresh`) keeps the task↔session edge.
- Live (`BERTH_LIVE=1`): real codex launch from a task → assert edge exists within ~1s (not 40s) and
  persists across a simulated restart (`refresh()` on a fresh store load).
- Regression: multiple codex sessions in one cwd → correct one binds (A), and B's time-window picks
  the right create event.
