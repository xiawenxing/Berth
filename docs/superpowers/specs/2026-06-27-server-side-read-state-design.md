# Server-side read-state (unread markers)

**Date:** 2026-06-27
**Branch:** `release/cli-availability-detection` (or a fresh `release/read-state-server-side`)
**Status:** Approved design — ready for implementation plan

## Problem

Session **read/unread** state (the dock red dot) is stored entirely in the browser's
`localStorage`, under three keys:

- `berth-last-seen` — `Record<sessionId, lastSeenSeconds>`
- `berth-unread` — `Record<sessionId, true>` (explicit 标为未读 overrides)
- `berth-unread-epoch` — first-run baseline (seconds)

The server (`src/server/status-ws.ts`) only broadcasts live activity + the latest message
`updatedAt`; it persists **no** read-state. The dot is computed purely client-side
(`web/src/lib/unread.ts` `contentIsUnread`), from localStorage vs. `updatedAt`.

`localStorage` is partitioned by **origin** (scheme + host + port). The two launch paths use
different origins:

| Launch | URL opened | origin |
|---|---|---|
| `berth start` (CLI) | `http://127.0.0.1:7777/app/` (`src/cli.ts`, default port 7777) | **stable** `127.0.0.1:7777` |
| berthapp (Electron) | `http://127.0.0.1:<random>/app/` (`electron/main.cjs`, `start(0, …)` → OS-assigned port) | **changes every launch** |

So the Electron app gets a fresh, empty `localStorage` on every launch: it can't see the CLI's
`berth-last-seen`, sets a new `berth-unread-epoch = now`, and every historical session resolves to
"read" (moored). Result: **unread sessions present in the CLI-launched Berth disappear in berthapp.**
The session list itself is fine (server-derived from `~/.berth` + CLI transcripts); only the unread
markers are lost. The same random-port issue means berthapp doesn't even retain read-state across its
own launches.

## Goal

Move read-state into the canonical server store (`~/.berth/berth.sqlite`) so it is origin-independent
and shared by every client — CLI browser and Electron app alike. Aligns with the Berth-canonical-data
direction.

## Scope

**In scope (MVP):**

- Persist read-state server-side; frontend loads it on mount and writes through REST.
- One-time per-origin migration of existing `localStorage` read-state into the server.

**Out of scope (YAGNI):**

- **Live cross-client sync** — broadcasting read-state changes over the `/status` WS so an
  already-open CLI tab updates its red dot in real time when the app marks something read. Deferred;
  a page reload is sufficient to reconcile. (The `/status` WS stays broadcast-only / server→client.)
- Auth / multi-user. Berth is single-user, loopback-only.

## Architecture

Server store is the single source of truth. The frontend keeps the same in-memory refs and the same
`LiveState` interface (so no consumer component changes), but seeds them from the server on mount and
mirrors every mutation to the server best-effort.

```
mount ─▶ migrate-once (origin-local) ─▶ GET /api/read-state ─▶ seed refs ─▶ bump()
markSeen/markUnread ─▶ update refs optimistically + bump() ─▶ POST (best-effort)
```

## Data model — `src/db/store.ts`

One new table, mirroring the existing `pin` / `session_import` pattern:

```sql
CREATE TABLE IF NOT EXISTS session_read (
  session_id      TEXT PRIMARY KEY,
  last_seen       INTEGER NOT NULL DEFAULT 0,   -- unix SECONDS (same unit the client uses today)
  explicit_unread INTEGER NOT NULL DEFAULT 0    -- 0/1, the 标为未读 override
);
```

The **unread-epoch** scalar reuses the existing settings KV (`getSetting`/`setSetting`, as used for
`locale`, `session-import-migrated`): key `unread-epoch`, string seconds. No dedicated table.

`explicit_unread` is an independent column because `contentIsUnread()` checks `explicitUnread` first —
a session can be explicitly marked unread even when `last_seen >= updatedAt`.

### New store methods

- `readState(): { lastSeen: Record<string, number>; unread: Record<string, true>; epoch: number }`
  - Full snapshot for the GET endpoint.
  - **Lazily initializes** `unread-epoch` to the current time (seconds) if unset, then returns it —
    preserving today's first-run baseline so a fresh install doesn't light up every historical CLI
    session as unread.
- `markSeen(ids: string[], ts: number): void`
  - `INSERT INTO session_read (session_id, last_seen, explicit_unread) VALUES (?, ?, 0)
     ON CONFLICT(session_id) DO UPDATE SET last_seen = max(last_seen, excluded.last_seen),
     explicit_unread = 0`
  - Covers single and batch (replaces the client's separate `markSeen` / `markSeenMany`). Wrap a
    multi-id call in one transaction.
- `markUnread(id: string): void`
  - `INSERT … VALUES (?, 0, 1) ON CONFLICT DO UPDATE SET explicit_unread = 1` (keeps any existing
    `last_seen`).
- `importReadState({ seen, unread, epoch }): void`
  - One-time merge. Per session: `last_seen = max(existing, incoming)`, `explicit_unread` OR'd.
  - epoch: if an existing epoch is set, `min(existing, incoming)`; else adopt incoming. Earliest
    baseline wins, so migrating a user's real (earlier) install epoch doesn't mark mid-life sessions
    unread.
  - `seen` is `Record<sessionId, seconds>`; `unread` is `Record<sessionId, true>`; `epoch` is seconds.

## REST API — `src/server/api.ts` (router mounted at `/api`, `/pin`-style)

| Method | Path | Body | Action |
|---|---|---|---|
| GET | `/api/read-state` | — | returns `{ lastSeen, unread, epoch }` from `store.readState()` |
| POST | `/api/read-state/seen` | `{ sessionIds: string[], ts?: number }` | `markSeen(sessionIds, ts ?? nowSeconds)` |
| POST | `/api/read-state/unread` | `{ sessionId: string }` | `markUnread(sessionId)` |
| POST | `/api/read-state/import` | `{ seen, unread, epoch }` | `importReadState(...)` |

- `ts` is optional. Opening/reading a session omits it → server stamps `now`. The active-session
  keep-in-sync path passes the message's `updatedAt` so the result matches today's
  `max(seen, updatedAt)` behavior.
- Validation follows the `/pin` precedent: 400 on missing/mistyped fields; otherwise `{ ok: true }`.

## Frontend — `web/src/lib/live.tsx`

Swap the three `localStorage`-backed refs for server-backed state. The `LiveState` interface and all
consumers are **unchanged**.

- **On mount (effect):**
  1. Run the one-time migration (below).
  2. `GET /api/read-state` → populate `seen` / `unread` / `epoch` refs → `bump()`.
  3. On GET failure: fall back to empty refs (everything moored), no crash; a reload re-fetches.
- **`markSeen(id)` / `markSeenMany(ids)`:** update `seen` refs (and clear matching `unread`)
  optimistically, `bump()`, then `POST /api/read-state/seen { sessionIds, ts? }` best-effort.
- **`markUnread(id)`:** set `unread` ref optimistically, `bump()`, then
  `POST /api/read-state/unread { sessionId }` best-effort.
- **Active-session keep-in-sync** (the `activeSession.current === m.sessionId` branch): still update
  the `seen` ref; `POST seen { sessionIds:[id], ts: updatedAt }`. Settles are infrequent enough to
  skip debouncing.
- POST failures are swallowed (same risk profile as today's `try/catch` around localStorage quota).
- `web/src/lib/unread.ts` (`contentIsUnread`, `resolveShipStatus`) is **unchanged**.

### One-time migration (per origin)

Runs once on mount, before the GET:

```
if (!localStorage['berth-read-migrated']
    && (localStorage has 'berth-last-seen' | 'berth-unread' | 'berth-unread-epoch')) {
  POST /api/read-state/import { seen, unread, epoch }   // server merges
  localStorage['berth-read-migrated'] = '1'
}
```

- Each origin migrates at most once (guard flag in that origin's own localStorage).
- The CLI origin pushes the user's real markers; the app origin (empty) is a no-op; the server holds
  the merged truth either way.
- Old keys are left in place (harmless; the guard prevents re-import). The GET still runs after a
  migration so the refs reflect the merged server state.

## Error handling

- All writes optimistic + best-effort; a failed POST leaves the UI correct for the session and is
  retried implicitly on the next mutation. No user-facing error.
- GET-on-mount failure → empty state (everything moored), no crash; reload re-fetches.

## Testing

- **`src/db/store.test.ts`** (new — none exists today):
  - `markSeen` upserts `max(last_seen)` and resets `explicit_unread` to 0.
  - `markUnread` sets the flag and preserves `last_seen`.
  - `importReadState` merge: `max` last_seen, OR'd unread, `min` epoch (and adopt-incoming when no
    existing epoch).
  - `readState` lazily defaults epoch when unset.
- **API:** add coverage if an api-level test harness exists; otherwise store-level tests carry the
  logic and the endpoints are thin pass-throughs.
- **`web/src/lib/live.test.tsx`:** replace localStorage assertions with `fetch` mocks — assert the
  GET-on-mount seed, the seen/unread POSTs, and migrate-once (POST `/import` only when localStorage
  has legacy keys and the guard is unset). Ship-status logic in `unread`/`live` tests stays.
- `npx tsc --noEmit` clean + `npm test` green before commit.

## Notes / non-goals

- This does not change session discovery or the `/status` activity channel; only read-state moves.
- Electron's random port is left as-is — server-side read-state makes it irrelevant to unread markers.
  (Pinning the Electron port is an orthogonal concern, not needed for this fix.)
