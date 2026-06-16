# Internal-agent auth-block fast feedback — design

**Date:** 2026-06-16
**Branch:** `release/hide-internal-agent-sessions`
**Status:** approved (design); ready for implementation plan

## Problem

Berth's internal **management agent** powers two user-facing actions:

- **✨ AI title** — `POST /api/sessions/:id/title` → `generateTitle` → `runAgent`.
- **⟳ Context summary** — `POST /api/sessions/:id/consolidate` → `runConsolidation` → `runAgent`.

`runAgent` runs the configured berth agent **headlessly**:

- claude: `claude -p <prompt> --dangerously-skip-permissions` (`runClaude`, `src/agent/index.ts`).
- codex: `codex exec … -o <file>` (`runCodex`, same file).

Headless `-p`/`exec` has **no TTY**. When the underlying CLI needs **re-authentication**
(expired/invalid credentials, OAuth refresh, "please log in"), the headless call cannot complete — it
either errors out or hangs. The HTTP endpoint `await`s the agent for up to **~105s**
(`generateTitle`/`generateProgressSummary`: 45s attempt + 60s fallback). The frontend
(`consolidateSession`/`generateTitle` in `public/app.js`) just spins the button for that whole window
with **no other feedback and no client-side timeout**, then maybe shows a generic alert.

From the user's seat this reads as "卡死了 — no result, no update." And because internal-agent
sessions are now **hidden** from the list (agent-cwd removed from `importRoots()`; sibling change on
this branch + ARCHITECTURE gotcha #7), there is no way to even peek at *why* it is stuck.

## Goal

When the internal agent is **blocked on authorization** (or otherwise fails to return), give the user
a **fast, clear, actionable error** — tell them exactly what to do (e.g. run `claude login` /
`codex login` then retry) — instead of a silent ~105s spinner.

Covers **both claude and codex** (whichever is the configured berth agent, `resolveBerthAgent`).

> **Decision (revised):** the lightweight "fast error" path was chosen over an interactive in-app
> recovery session. No PTY is spawned, no session is surfaced. Just detect → report clearly → user
> re-authenticates out of band and retries.

## Non-goals (v1)

- **No interactive recovery session.** We do not spawn an interactive `claude`/`codex` PTY, and we do
  not surface any internal-agent row in the list. agent-cwd stays fully hidden (shipped).
- **No auto-retry.** The user re-clicks ✨/⟳ after re-authenticating.
- coco is not a headless berth agent (`HEADLESS_CLIS = ['claude','codex']`) → out of scope.

## Key technical constraints

1. Detection is **best-effort**. The CLI may error fast (parseable stderr) or hang to timeout. We
   detect auth fast when a known signature appears in the stream; otherwise we fall back to the
   timeout and report a generic-but-clear "internal agent didn't respond" with the captured detail.
2. `runClaude` currently uses `exec` and **discards stderr**. We need stderr to classify, and ideally
   to **stream** it so we can abort early on an auth signature (rather than waiting the full timeout).
3. `runCodex` already captures the last 8KB of stderr — reuse it.

## Design — 3 components

### 1. Block detection + classification in the headless runner (`src/agent/index.ts`)

- **Capture stderr** for claude. Prefer **streaming** (`spawn` with a piped stderr) so we can
  pattern-match an auth signature and `kill` the child **early** — that is what makes the error
  *fast*. If streaming proves awkward, at minimum read `error.stderr` from `exec` and shorten the
  primary timeout so the user does not wait ~105s.
- **Classify** failures into `kind: 'auth' | 'timeout' | 'other'` and throw a typed
  `InternalAgentBlocked { kind, cli, detail }` (new error class) instead of a generic `Error`.
- **Per-CLI auth signatures** — a pure, table-driven classifier (the testable unit). Exact strings
  **must be confirmed empirically** (consistent with the repo's "verified empirically" notes) and
  documented in code:
  - claude: e.g. `Invalid API key`, `Please run /login`, `not authenticated`, OAuth/401 markers.
  - codex: e.g. its login-required / unauthorized stderr markers.
- Timeout → `kind:'timeout'`. Unrecognized → `kind:'other'` (carry `detail` = trimmed stderr tail so
  the message is still useful).

### 2. Endpoint feedback (`src/server/api.ts`)

- `/title` and `/consolidate` catch `InternalAgentBlocked` and return a **structured** error:
  - `409 { blocked: kind, cli, hint }` where `hint` is the actionable instruction
    (auth → "请运行 `claude login` / `codex login` 后重试"; timeout/other → a clear "内部 agent 未响应"
    with the detail). Reuse the existing `contextAgentError` shape, extended with `blocked`/`cli`/`hint`.
- The `generateTitle`/`generateProgressSummary` wrappers (`agent/index.ts`) must **propagate** the
  typed error rather than swallowing it in their `.catch(...)` fallback — the fallback should only
  retry on transient/`other` failures, not on `auth` (retrying an auth failure just doubles the wait).

### 3. Frontend feedback (`public/app.js`)

- `consolidateSession` / `generateTitle`: on a `blocked` response, show a **clear, actionable**
  message (replace the generic `alert('刷新上下文失败: …')`):
  > 内部 agent（{cli}）需要重新登录。请在终端运行 `{cli} login`，完成后重试。
  For `timeout`/`other`, show the detail.
- **Heartbeat:** while the request is pending, after ~15s update the button/label to
  "仍在处理…可能需要授权" so the wait is never silent. Client-side timer; does not abort the request.

## Data flow

```
user clicks ✨/⟳
  → POST /title|/consolidate
    → runAgent (headless claude -p / codex exec)
       ├─ success → title/summary returned (unchanged happy path)
       └─ stderr matches auth signature → kill early → InternalAgentBlocked{kind:'auth',cli,detail}
          (or timeout → kind:'timeout'; other failure → kind:'other')
            → 409 {blocked:kind, cli, hint}
  → frontend: actionable message ("请运行 `{cli} login` 后重试")
  → user re-authenticates out of band, re-clicks ✨/⟳ → succeeds
```

## Error handling

- The auth-fallback retry in `generateTitle`/`generateProgressSummary` must **not** re-run on
  `kind:'auth'` (no point; just slow). Transient/`other` may still get the one existing fallback.
- Endpoints still `refresh()` on failure (as today) so state stays consistent.

## Testing

- **Unit (pure):** `classifyAgentFailure(cli, stderr, timedOut) → kind` over a table of real-world
  stderr samples per CLI (claude + codex). The load-bearing, regression-prone unit.
- **Unit:** endpoint maps `InternalAgentBlocked{kind}` → the right status + `{blocked,cli,hint}` body
  (extend `api.test.ts`).
- **Unit:** the wrapper does not retry on `kind:'auth'`.
- **Live (`BERTH_LIVE=1`):** real unauthenticated invocation per CLI — only to *confirm the
  signatures*; cannot run in CI.

## Files touched (anticipated)

- `src/agent/agent-failure.ts` (new) — pure `classifyAgentFailure` + per-CLI signature tables +
  `InternalAgentBlocked` error class.
- `src/agent/index.ts` — capture/stream stderr; throw typed errors; don't retry on auth.
- `src/server/api.ts` — `/title` + `/consolidate` catch → `409 {blocked,cli,hint}`; extend
  `contextAgentError`.
- `public/app.js` — actionable message + heartbeat in `generateTitle`/`consolidateSession`.
- `docs/ARCHITECTURE.md` — note the auth-block fast-feedback behavior near gotcha #7.

## Open items to verify during implementation

1. Exact auth-error stderr signatures for claude `-p` and codex `exec` (empirical) — needed for the
   classifier and to confirm fast-fail is possible.
2. Whether claude `-p` / codex `exec` **hang** vs **error** on missing auth — if they reliably error
   on stderr, fast streaming detection works; if they hang, also shorten the primary timeout so the
   user gets feedback quickly regardless.
