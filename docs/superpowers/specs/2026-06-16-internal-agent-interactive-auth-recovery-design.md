# Internal-agent interactive auth recovery — design

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
(expired/invalid credentials, OAuth refresh, "please log in"), the headless call cannot complete the
auth — it either errors out or hangs. The HTTP endpoint `await`s the agent for up to **~105s**
(`generateTitle`/`generateProgressSummary` use a 45s attempt + a 60s fallback). The frontend
(`consolidateSession`/`generateTitle` in `public/app.js`) just spins the button for that whole window
with **no other feedback and no client-side timeout**, then maybe shows a generic alert.

From the user's seat this reads as "卡死了 — no result, no update." And because internal-agent
sessions are now **hidden** from the list (the agent-cwd was removed from `importRoots()`; see the
sibling change on this branch + ARCHITECTURE gotcha #7), there is no way to even peek at *why* it is
stuck.

## Goal

When the internal agent is **blocked on authorization**, turn it into a **visible, interactive
in-app session** the user can complete the login in — then retry and get their title/summary.

Covers **both claude and codex** (whichever is the configured berth agent, `resolveBerthAgent`).

## Non-goals (v1)

- **No auto-retry** of the title/consolidate after the user logs in — the user retries manually
  (approved). A retry affordance is fine; automatic re-invocation is out of scope.
- **Do not** make the *whole* title/consolidate run interactively. The headless path stays primary
  (clean structured output, `-o` file for codex); only **auth recovery** becomes interactive.
- coco is not a headless berth agent (`HEADLESS_CLIS = ['claude','codex']`), so it is not in scope as
  a management agent and needs no recovery path here.

## Key technical constraints

1. **`claude -p` / `codex exec` are non-interactive** — auth cannot be completed there. Recovery
   requires spawning the CLI **interactively in a PTY** (`claude` / `codex`).
2. The headless process runs via `exec`/`spawn` in `agent/index.ts`, **separate from the
   `pty-registry`**. It cannot be "promoted" to interactive; recovery spawns a *new* interactive PTY.
3. agent-cwd was just **removed from `importRoots()`** (this branch). The recovery session must be
   surfaced **despite** that, without re-flooding historical agent-cwd sessions.
4. **Detection is best-effort.** The CLI may error fast (parseable stderr) or hang to timeout. We
   detect fast when we can; we always offer the interactive session on any non-return.

## Design — 4 components

### 1. Block detection in the headless runner (`src/agent/index.ts`)

- **Capture stderr.** `runClaude` currently uses `exec` and discards stderr — switch so stderr is
  available (either inspect `exec`'s `error.stderr`, or move to a streaming `spawn` so we can
  pattern-match early and abort before the full timeout). `runCodex` already captures the last 8KB of
  stderr — reuse it.
- **Classify** a failure into `kind: 'auth' | 'timeout' | 'other'` and throw a typed
  `InternalAgentBlocked { kind, cli, detail }` (new error class) instead of a generic `Error`.
- **Per-CLI auth signatures** (a pure, table-driven classifier — the testable unit). Exact strings
  **must be confirmed empirically** (consistent with the repo's "verified empirically" notes) and
  documented in code:
  - claude: e.g. `Invalid API key`, `Please run /login`, `not authenticated`, OAuth/401 markers.
  - codex: e.g. its login-required / unauthorized stderr markers.
- Timeout → `kind:'timeout'`. Anything unrecognized → `kind:'other'`. **On `timeout` and `other` we
  still offer the interactive session** (the user may discover it is an auth/trust issue); the kind
  only sharpens the message.

### 2. Interactive recovery session (reuse `pty/launch.ts` + `server/pty-registry.ts`)

- On a block, spawn **one** interactive PTY for the **configured berth-agent CLI** in
  `berthAgentCwd()` via `launchFresh(cli, …)`, registered with `registerPty` under a **well-known,
  reused internal key** (e.g. `__berth_internal_auth__`). One shared recovery session — **reuse** it
  if a live one already exists (`hasLivePty(key)`), never one-per-failed-title.
- The interactive login/trust flow then renders in a normal in-app xterm the user can type into.
- **CLI-aware spawn:**
  - claude: interactive `claude` in agent-cwd. `ensureClaudeTrust(agent-cwd)` already pre-seeds trust
    (gotcha #11) so only the *auth* prompt remains.
  - codex: interactive `codex` in agent-cwd. agent-cwd may not be a git repo — ensure the interactive
    invocation tolerates that (the codex equivalent of `--skip-git-repo-check`, or accept the repo
    prompt). **Verify empirically.** codex has no `--session-id`; keying by the internal key (below)
    sidesteps reconcile entirely.

### 3. Conditional surfacing (`server/store-singleton.ts` / `server/api.ts` serialize)

- agent-cwd stays hidden by default (shipped). When a **live** internal-agent PTY exists under the
  internal key, **inject a single synthetic session row** into `GET /api/sessions` regardless of
  `importRoots()`, labeled **"Berth 内部 agent — 需要授权"** with `cli` set to the recovery CLI.
- The synthetic row carries a stable id mapping to the internal PTY key so the existing terminal view
  can attach. `/pty` attach is by key (`attachViewer(key, ws)`); add a small mapping so resuming the
  synthetic id attaches to `__berth_internal_auth__`.
- When the recovery PTY exits, the row disappears (no live PTY → not injected). Historical agent-cwd
  sessions remain hidden — only the *live* recovery session surfaces.

### 4. Endpoint + frontend feedback (`server/api.ts`, `public/app.js`)

- `/title` and `/consolidate` catch `InternalAgentBlocked`:
  - On `auth` (and, best-effort, `timeout`/`other` after the long wait): ensure the recovery session
    is spawned and return **`409 { blocked: <kind>, sessionId: <synthetic recovery id>, cli }`**.
- Frontend replaces the generic alert with an **actionable** prompt:
  > 内部 agent 需要授权（{cli}）。点此打开会话完成登录，然后重试。
  Clicking opens the terminal for that session (existing `openTerminalFor`).
- **Heartbeat:** while the request is pending, after ~15s update the spinner/label to
  "仍在处理…可能需要授权" so the wait is never silent. (Client-side timer; does not abort the request.)
- After login, the user re-clicks ✨/⟳ (no auto-retry in v1).

## Data flow

```
user clicks ✨/⟳
  → POST /title|/consolidate
    → runAgent (headless claude -p / codex exec)
       ├─ success → title/summary returned (unchanged happy path)
       └─ InternalAgentBlocked{kind,cli}
            → ensureRecoverySession(cli)  // spawn+register interactive PTY @ __berth_internal_auth__ (reuse if live)
            → 409 {blocked:kind, sessionId, cli}
  → frontend: actionable prompt → openTerminalFor(sessionId)
  → user completes login in the in-app terminal
  → user re-clicks ✨/⟳  → now succeeds
```

## Error handling

- `ensureRecoverySession` is idempotent: reuse a live PTY, else spawn. Spawn failure → fall back to a
  plain error alert (no infinite loop).
- The recovery PTY is a normal registry entry: **×** detaches, **■** kills (existing semantics). On
  exit, the synthetic row vanishes.
- Endpoints still `refresh()` on failure (as today) so state stays consistent.

## Testing

- **Unit (pure):** `classifyAgentFailure(cli, stderr, timedOut) → kind` over a table of real-world
  stderr samples per CLI (claude + codex). The load-bearing, regression-prone unit.
- **Unit:** surfacing logic — given `hasLivePty(internalKey)` true/false, the serialized session list
  includes / omits exactly one synthetic recovery row; historical agent-cwd sessions stay hidden in
  both cases.
- **Unit:** synthetic-id → internal-key attach mapping.
- **Live (`BERTH_LIVE=1`):** the actual interactive spawn + auth flow per CLI (cannot run in CI).

## Files touched (anticipated)

- `src/agent/index.ts` — capture stderr, `InternalAgentBlocked`, throw typed errors.
- `src/agent/agent-failure.ts` (new) — pure `classifyAgentFailure` + signature tables.
- `src/server/internal-agent-session.ts` (new) — `ensureRecoverySession(cli)` + internal key +
  synthetic-id mapping helpers.
- `src/server/store-singleton.ts` or `src/server/api.ts` — inject the synthetic row when live.
- `src/server/pty-ws.ts` — attach synthetic recovery id → internal key.
- `src/server/api.ts` — `/title` + `/consolidate` catch → 409 `{blocked,…}`.
- `public/app.js` — actionable prompt + heartbeat in `generateTitle`/`consolidateSession`.
- `docs/ARCHITECTURE.md` — extend gotcha #7 with the conditional-surfacing-on-block behavior.

## Open items to verify during implementation

1. Exact auth-error stderr signatures for claude `-p` and codex `exec` (empirical).
2. Whether claude `-p` / codex `exec` **hang** vs **error** on missing auth (drives how much we rely
   on fast detection vs the timeout path).
3. Interactive `codex` in a non-git agent-cwd — flag/behavior to avoid a spurious repo prompt.
