# Design: `berth session` — bind existing sessions to tasks

**Date:** 2026-06-28
**Branch:** `release/session-task-bind`
**Status:** Approved

## Problem

The berth CLI/server exposes no agent-facing way to associate an **already-existing
session** (running *or* finished) with a task after the fact. Today a session binds to
a task only:

- **at launch**, via the WebSocket `?todoKey=<taskId>` param (`src/server/pty-ws.ts:428-437`), or
- **post-hoc for codex only**, via `reconcileLaunchIntents()` (`src/server/reconcile.ts:28-74`).

The backend `POST /api/edge` (`src/server/api.ts:172-182`) *can* bind an existing
session, but it is **UI-only** — there is no `berth session` CLI command at all. This
blocks the workflow: *"an agent does some work, then realizes the session should be
associated with task X."*

## Goal

Add a `berth session` command group that lets an agent bind/unbind/list session↔task
associations, covering both:

- **self-bind** — an agent binds *its own* current session, and
- **explicit bind** — a caller binds an arbitrary session by id.

Works identically for running and finished sessions (the `edge` table is just id↔id,
with no liveness requirement).

## Non-goals (YAGNI)

- No new HTTP endpoints — reuse `POST /api/edge` and `GET /api/sessions`.
- No task-title resolution inside the CLI — agents already resolve title→id via
  `berth task list`.
- No project-only bind sugar.

## Components

### 1. Env injection (new)

Inject `BERTH_SESSION_ID=<sessionId>` into the spawned PTY env so a self-bind can
resolve deterministically. Natural home: `src/pty/agent-env.ts` (already injects
`BERTH_PORT`/`BERTH_HOST`) or `src/pty/launch.ts` where the id is minted.

- **claude / coco** — session id is known at launch (`--session-id <id>`), so
  `BERTH_SESSION_ID` is set reliably.
- **codex** — no id is minted at launch; `BERTH_SESSION_ID` is therefore **absent**.
  codex self-bind falls back to the cwd heuristic (below) until `reconcile` resolves
  the edge. This is expected and acceptable.

### 2. CLI surface (new)

Dispatch a `session` group in `src/cli.ts` (alongside `task`/`project`), implemented as
`runSessionCli()` in `src/cli-data.ts`:

```
berth session bind   [<sessionId>] <taskId> [--project <id>]   # re-bind (moves session)
berth session unbind [<sessionId>]                              # clear task edge, keep project attach
berth session list   [--task <id>] [--json]                    # sessions + their bound task
```

- `<sessionId>` is **optional**; when omitted it is resolved via the self-resolution
  helper (§3).
- **bind** uses *replace* semantics (re-bind): it moves the session to the new task and
  never errors if already bound — matching `POST /api/edge`, which does
  remove-then-add.

### 3. Self-resolution helper (new, in `cli-data.ts`)

`resolveCurrentSession()` returns the session id for "my current session":

1. If `BERTH_SESSION_ID` is set in the environment → use it.
2. Else `GET /api/sessions`, filter sessions whose `cwd` matches
   `canonicalPathKey(process.cwd())` (symlink-normalized, as `reconcile.ts` does), and
   pick the **most-recently-updated** match. Print a warning that the session was
   *inferred* from cwd.
3. If no match, or the match is ambiguous in a way we can't break → **error** instructing
   the caller to pass an explicit `<sessionId>` (suggest `berth session list`).

This mirrors the `reconcile.ts` heuristic but runs **client-side** against
`/api/sessions`; no server change. If `canonicalPathKey` is not cleanly importable into
the CLI context, replicate its small normalization locally.

### 4. Backend — reuse, no new endpoints

| CLI action | Request |
|---|---|
| `bind`   | `POST /api/edge { sessionId, todoKey: <taskId>, projectId? }` — already remove-then-add = re-bind |
| `unbind` | `POST /api/edge { sessionId }` with no `todoKey`/`projectId` → clears the edge, leaves `attach` intact |
| `list`   | `GET /api/sessions` → already returns `sessionId, cli, cwd, status, updatedAt` + bound task (via `edgesByTodo()` reverse map); format a table client-side, `--json` for raw |

### 5. Reach & testing

- CLI reaches the server via the existing `__resolveBaseUrl()` discovery
  (`src/cli-data.ts:92-100`): `--port` > `BERTH_PORT` > `PORT` > portfile
  (`~/.berth/server.json`) > `7777`. No new plumbing.
- **Unit tests** (mirror existing `cli-data` test patterns):
  - `resolveCurrentSession`: env-hit, cwd-fallback (single match), ambiguous/none → error.
  - `bind`/`unbind`/`list` argument parsing and request shaping (sessionId optional,
    `--project`, `--task`, `--json`).
- **Live test** (`*.live.test.ts`, behind `BERTH_LIVE=1`): real round-trip —
  start server, create a task, bind a session id, assert `GET /api/sessions` shows the
  edge, then `unbind` and assert it's gone.

## Files touched (estimate)

- `src/pty/agent-env.ts` (or `src/pty/launch.ts`) — add `BERTH_SESSION_ID` injection.
- `src/cli.ts` — dispatch `session` subcommand.
- `src/cli-data.ts` — `runSessionCli()` + `resolveCurrentSession()`.
- tests — new `session` CLI tests; optional live round-trip test.

No backend/API or DB schema changes.
