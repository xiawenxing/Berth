# Server-process split + scan root-cause fixes (2.0.3)

**Date:** 2026-06-29
**Branch:** `feat/server-process-split-and-scan-fixes` (off `release/2.0.3`)

## Problem

A running 2.0.x app became almost unusable. Root-cause investigation (stack sample + lsof + DB):

1. The Electron app boots the Berth server **in-process** (`electron/main.cjs` → `import('dist/server/index.js')`),
   so the backend event loop runs on the **same thread as the UI**. A pegged server = a frozen UI.
2. The client polls `POST /api/refresh` every 2.5s while any launch placeholder is "pending"
   (`web/src/lib/data.tsx:182`). `refresh()` runs a **full content re-read** of all three CLI session
   stores (`collectLogicalSessions` → glob + open+read first line of every file). The stores had grown
   to ~900 MB, so each scan takes seconds and blocks the loop.
3. Launches that never **surface** (e.g. codex bind failures — 3 unbound intents 5–8 days old, 261
   accumulated `launch_intent` rows) keep `pending` non-empty → the full-scan poll never stops.
4. Discovery is broken: `~/.berth/server.json` is **empty**, and `electron/main.cjs` only health-checks
   `7777` then falls back to a random port (observed: app on `:58128`, a second idle `berth start` on
   `:7777`). So two servers coexist and reuse fails depending on launch order.

## Goals

- The server is **always a separate process** from the Electron/web UI. No code path runs it on the UI thread.
- **Bidirectional discovery/reuse**: whichever of {app, CLI} starts second detects the already-bound
  address (any port) and reuses it. Prefer `7777`; fall back to a free port only when a non-Berth
  process holds `7777`; always record the actual address.
- `refresh()` is **incremental** — cost ∝ file count (stat) + changed files (read), not total bytes.
- The pending-launch poll is **targeted and bounded** — no global rescan; stuck launches expire.
- Deliver an **ad-hoc, unnotarized DMG (arm64)** of 2.0.3.

Non-goal (YAGNI): a `worker_thread` for the scan. The process split already moves it off the UI thread;
incremental scan keeps the server process responsive. Revisit only if the server process itself janks.

## Design

### C1 — Server as a separate process (`electron/main.cjs`)

- Replace the in-process `import(serverEntry); start()` with Electron **`utilityProcess.fork(serverEntry)`**.
  The utility process runs Electron's Node runtime, so the Electron-ABI native modules
  (`better-sqlite3`, `node-pty`) load unchanged. A small CJS bootstrap entry
  (`electron/server-process.cjs`) dynamic-imports the ESM `dist/server/index.js` and calls `start()`,
  then posts the resolved `{port, host}` back to the parent via `process.parentPort`.
- Main waits for the `listening` message (or a health poll) before `loadURL`.
- On `before-quit`, main kills the utility process; the server's existing SIGTERM cleanup tears down PTYs.

### C2 — Bidirectional discovery contract (`~/.berth/server.json`)

Shared by both the app and the `berth` CLI. Centralize in `src/server-discovery.ts` (read) and the
server `start()` (write):

- **Record shape:** `{ berth: true, port, host, pid, startedAt }`. Written **atomically** (tmp + rename)
  immediately after `listen` succeeds.
- **Reuse-or-bind (both app and CLI):**
  1. Read `server.json`. If present and `GET /api/health` ⇒ `{berth:true}`, **reuse** that address; do not bind.
  2. Else bind, preferring `7777`. On `EADDRINUSE`, health-check `7777`: if Berth, reuse; if non-Berth,
     bind port `0` (free port).
  3. After a successful bind, overwrite `server.json` with the actual address.
- Stale record (process gone / health fails) is ignored and overwritten. Fixes the empty-file bug:
  `start()` must always write the record (the in-process path skipped it).

### C3 — Incremental scan (`src/adapters/{claude,codex,coco}.ts`, `src/sessions.ts`)

- Per-adapter **mtime cache**: `readdir` + `stat` every candidate file (cheap); `readFile` only files whose
  `mtimeMs` changed since the last scan; reuse cached parsed metadata otherwise. Cache lives in the server
  process (module-level, keyed by absolute path).
- **Codex** primary path: read `session_index.jsonl` for session metadata instead of opening every
  `rollout-*.jsonl`; fall back to per-file read only for entries absent from the index or newer than it.
- `collectLogicalSessions` stays pure in signature; the cache is internal to the adapters.

### C4 — Targeted, bounded pending poll (`web/src/lib/data.tsx`, `src/server/api.ts`)

- The server already binds launches via per-intent rollout-watch/reconcile (`watchCodexFirstTurn`,
  `rollout-watch.ts`). The client poll must **not** call the global `POST /api/refresh`.
- Replace it with a **targeted resolve** keyed to the specific pending launch(es): a lightweight endpoint
  (e.g. `GET /api/launches/resolve?tokens=...` or reuse `/api/sessions` cache + a per-intent reconcile
  trigger) that resolves only those intents and returns whether each surfaced — **never**
  `collectLogicalSessions`.
- **Bound it:** tighten server-side TTL expiry of unbound intents (`selectExpiredUnboundIntents`) and keep
  the client's pending self-expiry (`data.tsx` aging) so a failed bind can't loop forever.
- **One-time cleanup:** a startup sweep drops chronically-unbound intents past TTL and prunes the
  accumulated `launch_intent` rows (the 3 stuck + 261 total observed).

### C5 — Cleanup + packaging

- Terminate the stray runtime processes: the pegged old-2.0.2 in-process server (`:58128`) and the idle
  standalone `berth start` (`:7777`).
- Bump `package.json` to `2.0.3`.
- Build: `BERTH_ALLOW_UNNOTARIZED_MAC=1 npm run electron:release` → ad-hoc, unnotarized **DMG (arm64)** in `./release`.

## Testing (TDD)

- **C2 discovery:** reuse when `server.json` healthy; bind+record when absent; fall back to free port when
  `7777` is non-Berth; ignore+overwrite stale record.
- **C3 scan:** second scan over unchanged mtimes performs **zero** content reads (spy on `readFile`); codex
  reads `session_index.jsonl` and only opens index-missing files.
- **C4 poll:** the resolve endpoint does **not** call `collectLogicalSessions`; unbound-intent expiry stops
  the loop.
- **C1 process split:** verified at packaging/smoke time — the Electron **main** process holds no LISTEN
  socket; the server runs as a utility process.

## Sequencing

1. C2 discovery contract (pure, well-isolated) — unit-tested first.
2. C3 incremental scan — unit-tested; biggest CPU win.
3. C4 pending poll + intent cleanup — backend endpoint + web change.
4. C1 server-process split — wire `utilityProcess`; depends on C2 record being written.
5. C5 cleanup + DMG build + smoke verification.
