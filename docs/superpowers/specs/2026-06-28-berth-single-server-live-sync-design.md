# Berth — single shared server + task-data live sync

**Date:** 2026-06-28
**Status:** Design approved (brainstorming), pending spec review → implementation plan
**Branch:** `release/berth-single-server-live-sync`

## Problem

The `berth` CLI / `berth-tasks` skill talk to a Berth server over REST (default `127.0.0.1:7777`).
Today that contract is broken for normal installs, and even when it works the UI doesn't update:

1. **Berth.app starts its server on a random port** (`main.cjs` → `start(0, …)`), so the CLI's default
   `7777` never reaches it. A task created via CLI lands in a *different* server process than the one the
   app window is showing (they only happened to agree here because this dev box also runs a separate
   `berth start` on 7777 sharing the same `~/.berth`).
2. **An app-only user has no `berth` CLI at all** — the packaged `.app` installs no CLI shim — so an agent
   running inside a Berth session can't invoke the skill.
3. **No live refresh:** the React SPA loads `projects/todos/sessions` once on mount and only re-fetches on a
   `nonce` bump from in-app actions (`web/src/lib/data.tsx`). A task created out-of-band (CLI / API) never
   appears until the page is manually reloaded.

Observed symptom that started this: a task created via CLI did not show in the open Berth.app window.

## Goals

- **One shared backend server** per `~/.berth` store. The app, the CLI, and a browser tab all use the same
  server + the same SQLite store. The only frontends that differ are the *shells*: the Electron window and
  the browser HTML page.
- **The skill works on an app-only install** with zero manual steps: the agent finds `berth` and reaches the
  running server automatically — **no second `start`, no global install required.**
- **Backend task-data changes push to the frontend** so the UI updates without a manual reload.

## Non-goals

- Authentication / multi-user (server stays single-user, loopback-only).
- Incremental deltas to the frontend — we send a "refetch" signal and reuse the existing full reload.
- A user-facing "install `berth` into my shell PATH" command for *out-of-session* terminal use. It's a nice
  optional follow-up, but the skill never depends on it (see A1 below). Not built here.

## Core invariant

> **Whoever starts first hosts the one server on the canonical port (default `7777`, overridable via
> `$PORT`). Everyone else connects. `berth start` is idempotent — if a Berth server already answers on the
> target port, it reuses it (opens a frontend) instead of starting a second one.**

`dev:clean` (`PORT=7788 BERTH_HOME=/tmp/berth-clean`) is the one deliberate exception: a separate port +
store + process, fully isolated.

---

## Part A — single shared server + connectivity

### A.1 Health endpoint (server identity probe)

Add `GET /api/health` → `{ berth: true, version, berthHome, pid }`. Used by the app and `berth start` to
answer "is the thing on this port a Berth server, and is it mine (same `berthHome`)?" Cheap, unauthenticated,
loopback-only like the rest.

### A.2 Canonical port + first-starter-hosts

- **`berth start` (`cli.ts`):** before binding, probe `GET /api/health` on the target port (`$PORT` or 7777).
  - Berth server already there (matching `berthHome`) → **don't bind a second**; open the browser at that
    server and exit 0 with a clear "already running" message.
  - Nothing there → start the server as today.
  - A *non-Berth* process holding the port → fail with a clear message (don't silently pick another port for
    the CLI-start path; the user asked for that port).
- **Berth.app (`electron/main.cjs`):** replace `start(0)` with:
  1. Probe `GET /api/health` on the canonical port (`$PORT` or 7777).
  2. Berth server already there → **reuse it**: open the `BrowserWindow` at `http://127.0.0.1:<port>/app/`,
     do **not** boot an in-process server.
  3. Nothing there → boot the server in-process on the canonical port, then open the window.
  4. Canonical port taken by a non-Berth process → boot on an OS-assigned free port **and** record it in the
     port file (A.3) so the CLI can still find it; open the window there.
  - Honor `$PORT` / `$BERTH_HOME` so `dev:clean` stays isolated.

### A.3 Port file (discovery for non-default ports)

On successful `listen`, the server atomically writes `~/.berth/server.json`:
`{ port, host, pid, startedAt, version }` (under `$BERTH_HOME`). Best-effort removed on graceful shutdown;
readers treat a file whose `pid` is dead as absent. This is the fallback discovery channel for the
non-7777 cases (port conflict, or a future multi-instance setup). In the common case everything is on 7777
and the file is just confirmation.

### A.4 Agent env injection — makes the skill work in-session (A1 + connectivity)

At the **`launch.ts` spawn sites** (the same five points touched by the clipboard `withUtf8Locale` work —
consolidate into one `agentSpawnEnv(baseEnv, { port, host })` helper that also applies `withUtf8Locale`),
inject into every Berth-spawned agent PTY:

- **`PATH` prepended with a Berth-provided bin dir** containing a `berth` shim. For the packaged app the shim
  runs the bundled `bin/berth.mjs` via Electron-as-Node (`ELECTRON_RUN_AS_NODE=1 <Berth.app>/…/MacOS/Berth
  <resources>/bin/berth.mjs "$@"`); for the CLI-hosted server it points at the installed `berth`. This is the
  "auto-install CLI" the user accepted — **scoped to the session env, zero global-PATH footprint.**
- **`BERTH_PORT` / `BERTH_HOST`** = the address of the server that spawned this agent.

So an agent running the skill's `berth task …`: (1) resolves `berth` from PATH, (2) connects to the exact
server that launched it — even on a non-7777 port (`dev:clean`, conflict fallback). No `start`, no global
install.

The server learns its own port via a tiny module setter (`recordServerAddress(port, host)`) called from
`start()` after `listen`; `launch.ts` reads it for injection and `server.json`.

### A.5 CLI connect resolution order

`cli-data.ts baseUrl()` resolves the server address in this order:

1. `--port` / `--host` (explicit) — always wins.
2. `$BERTH_PORT` / `$BERTH_HOST` (injected into agent sessions) — so an in-session agent reaches *its* server.
3. `$PORT` / `$HOST` (existing behavior, e.g. a dev shell).
4. `~/.berth/server.json` (if `pid` alive).
5. `127.0.0.1:7777` (default).

`berth task` / `berth project` are **connect-only — they never auto-start a server.** If nothing is reachable
they fail with the existing hint pointing at the app / `berth start`. Only `berth start` starts a server.

### A.6 Scenario walk-through

- **App-only, launched from app:** app sees 7777 empty → hosts on 7777 → agent sessions get `berth` (PATH) +
  `BERTH_PORT=7777` → skill's `berth task` hits the app's server. ✓
- **CLI-only, `berth start`:** hosts on 7777 + opens browser. ✓
- **Both installed, app first then CLI:** app hosts 7777; `berth task` connects to 7777; a stray `berth start`
  probes 7777, finds Berth, reuses (opens browser) — never a second server. ✓ (cli-first-then-app is symmetric.)
- **`dev:clean`:** `PORT=7788` + isolated `BERTH_HOME` → separate server/store/process; its agents get
  `BERTH_PORT=7788` and talk only to it. ✓

---

## Part B — backend → frontend live refresh (push)

Sits on top of A. With one shared server, the in-process path covers the normal case; a `data_version` poll
covers the rare multi-instance case.

### B.1 Broadcast channel

Reuse the existing **`/status`** broadcast WS (`src/server/status-ws.ts`). Add an exported
`broadcastDataChanged()` that emits a `{ t: 'data' }` frame ("task data changed — refetch"). A generic signal
(not a delta) — the frontend already does a full `nonce`-driven refetch.

### B.2 In-process triggers

Call `broadcastDataChanged()` from the task-mutation endpoints in `api.ts`:
`POST /todos`, `PATCH /todos/:id`, `DELETE /todos/:id`, `POST /todos/:id/title`, `POST /edge`. **Debounced
~200ms** server-side to coalesce bursts (e.g. a sync writing many rows).

### B.3 Cross-process safety net

Each server polls `PRAGMA data_version` (~1.5s; a no-I/O counter that bumps when **another connection/process**
commits). On change → `broadcastDataChanged()`. Covers CLI-on-another-server / `dev:clean` / manual SQLite
edits. (`data_version` does **not** fire for same-connection writes, so B.2 + B.3 together cover all cases.)
Secondary priority — can ship after B.1/B.2 if needed.

### B.4 Frontend

In `web/src/lib/live.tsx` (the existing `/status` consumer), handle the `{ t: 'data' }` frame by triggering
`data.tsx`'s reload (`setNonce(n => n+1)`), client-debounced (~200ms). Result: projects/todos/sessions
re-fetch and the board updates with no manual reload.

---

## Testing

**A**
- `cli-data.ts baseUrl()` resolution order — table of (flags, `$BERTH_PORT`, `$PORT`, `server.json`, default).
- `server.json` write on listen / atomic / removed on shutdown / dead-pid treated as absent.
- `/api/health` shape + identity (`berthHome` match).
- `agentSpawnEnv()` injects `PATH` (berth shim dir) + `BERTH_PORT`/`BERTH_HOST` and still applies
  `withUtf8Locale`; assert at the launch.ts spawn sites.
- `berth start` idempotency: server already on port → no second bind, exit 0.

**B**
- Each mutation endpoint calls `broadcastDataChanged()` (debounced) — unit with a fake `/status` client.
- `data_version` poll detects an external write → broadcasts.
- `live.tsx` reloads on a `{ t: 'data' }` frame (component test); client debounce coalesces bursts.

## Resolved decisions

1. Frontend refresh = **full refetch** (reuse `nonce`), not incremental deltas.
2. `$BERTH_PORT` ranks **above** `$PORT` (an in-session agent must reach the server that spawned it).
3. Cross-process detection via **`PRAGMA data_version` poll**, not file watching.
4. **Never auto-start** a second server from data commands; `berth start` is idempotent-reuse.
5. CLI made available to in-session agents via **session-scoped PATH injection** (A.4), not a required global
   install. A global "install command" is an optional, separate follow-up.

## Open follow-ups (out of scope here)

- A1-global: a user-triggered "install `berth` to my shell PATH" for out-of-session terminal use.
- The `withUtf8Locale` clipboard fix lives on `release/clipboard-mac-roman-flavor`; the `agentSpawnEnv`
  consolidation in A.4 should land after/with that merge so both env injections share one helper.
