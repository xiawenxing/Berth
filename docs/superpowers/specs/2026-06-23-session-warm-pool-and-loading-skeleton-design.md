# Session warm-pool + loading skeleton — design

> Date: 2026-06-23 · Branch: `release/berth-2.0-ia`
> Goal: kill the multi-second blank when opening a *historical* (not-yet-live) session in the
> Berth 2.0 (`web/`) session drawer.

## Problem

Opening an existing session in the drawer shows a blank terminal for a few seconds before any
content appears. Root cause (traced through `web/` + `src/`):

Berth has **no stored transcript it replays**. It uses a persistent-PTY + ring-buffer model. The
resume branch in `src/server/pty-ws.ts:252-270` has two paths:

- **Fast path** — `hasLivePty(sessionId)` true → `attachViewer()` replays the in-memory ring buffer
  → ~10–50ms, instant.
- **Slow path** — no live PTY → `resumeSession()` **synchronously spawns the CLI child**
  (`src/pty/launch.ts:56`), which then takes 2–5s to boot and redraw its prompt. `attachViewer()`
  finds an **empty** ring buffer (`pty-registry.ts:111`, the child hasn't emitted yet) and sends
  nothing → the client renders a blank xterm until the CLI's first bytes arrive.

Historical sessions are ingested from disk adapters and were **never spawned in this server run**,
so `hasLivePty` is always false on first open → every first-open pays the cold spawn. (Second open
is fast — the PTY stays alive after the drawer closes; `pty-registry.ts:136` detaches only.)

Two aggravators:
- **coco cold start**: `resolveAgentBinary('coco')` → `verifyCoco` runs `coco --help` (4–15s,
  *synchronous* `execFileSync`) when not yet cached.
- **No loading affordance**: `web/src/components/Terminal.tsx` mounts an empty xterm
  (`Terminal.tsx:129`) and only fills on the first `ws.onmessage` (`Terminal.tsx:242`). Nothing
  tells the user it's working → reads as "broken / blank".

## Relationship to prior work

Supersedes the warming portion of `2026-06-14-session-preload-warm-cache-design.md`, which targeted
the **frozen 1.0 `public/app.js` frontend**. Its `killAllPtys` + graceful-shutdown piece already
shipped (`src/server/index.ts:58-65`). This design moves warming **server-side** (at boot,
browser-independent) and reuses that spec's proven shape: priority picker, serial/throttled warm,
protect pinned/running, kill-on-evict.

## Requirements (confirmed with owner)

1. **Server-side bounded warm pool**: at server start, pre-spawn the top-K resumable sessions so
   their first open hits the fast path. K default **6**, configurable, `0` disables.
2. **Loading skeleton** in the `web/` Terminal: a delayed overlay so cold opens show "正在恢复会话…"
   instead of blank, while fast-path opens stay flash-free.
3. **CLI cold-start warm-up**: ensure coco's slow `--help` probe is paid off the click path (mostly
   already done by `warmAgentBinaryCaches`); the warm pool finishes the gap.

Ordering note: the owner's original "pin → unread → recent" can't be honored verbatim server-side —
**unread is client-only** (`web/src/lib/live.tsx:28-29`, `localStorage` `berth-last-seen` /
`berth-unread`). The server ranks by what it can see: **pinned → running (activity) → recent
(updatedAt)**. Accepted.

## Components

### 1. Shared spawn-and-register helper — `src/server/pty-ws.ts` (extract)

Extract the resume-spawn-register sequence (`pty-ws.ts:259-268`) into one helper so the /pty resume
branch and the warm pool share identical behavior:

```
spawnAndRegister(s: LogicalSession, { cols, rows }): IPty
  // resumeSession(s, {cols,rows})
  // codexState = codexActivityStateForSession(s)
  // registerPty(s.sessionId, pty, { running: codexState==='running',
  //                                 holdRunning: s.cli==='codex' ? codexHoldRunning(codexState) : undefined })
  // returns pty
```

The /pty resume branch (`pty-ws.ts:259-269`) becomes `spawnAndRegister(s, {cols,rows})` then
`attachViewer`. Pure refactor — existing behavior unchanged, covered by current tests.

### 2. Priority picker (pure, unit-tested) — `selectWarmSessions`

`selectWarmSessions(sessions: SerializedSession[], k: number): string[]` (sessionIds).

Filter out, then order, then take `k`:
- **Skip**: `deleted`, no `resume` capability, or already `hasLivePty` (live → no warming needed).
  (Binary-missing is filtered at warm time, not here — see §3.)
- **Order**: `pinned` first, then `activity === 'running'`, then `updatedAt` desc; stable within tier
  by `updatedAt` desc.

No process/DOM side effects — the one piece with a focused unit test. Operates on the same shape
`serialize()` returns (`api.ts:114`), so `pinned`/`activity`/`updatedAt`/`deleted` are all present.

### 3. Warm pool — new module `src/server/warm-pool.ts`

State: `warmPool` = insertion-ordered `Map<sessionId, true>` of sessions **we spawned that the user
hasn't opened yet** (the only entries eligible for eviction).

`warmSessionPool()` — fire-and-forget kickoff:
- Read `k = warmPoolSize()` (§5). If `0`, return.
- `ids = selectWarmSessions(serialize(), k)`.
- Process through a **throttle of ≤ 2 concurrent spawns** (never a boot-time spawn storm):
  - Resolve `bin = firstUsableCandidate(s.cli)`; if null → skip (binary absent).
  - **coco gate**: `if (s.cli === 'coco') await verifyCocoAsync(bin)` — reuses the in-flight promise
    `warmAgentBinaryCaches` already started, so `resumeSession`'s synchronous `verifyCoco` is a
    cache hit (never blocks the event loop here).
  - `if (hasLivePty(id)) continue` (re-check; another path may have spawned it).
  - `spawnAndRegister(s, { cols: 120, rows: 30 })`; on throw, log + skip (one bad session never
    aborts the pool). Real clients send a resize on attach, so default geometry is fine.
  - Add `id` to `warmPool`; register an exit hook to drop `id` from `warmPool` when the PTY exits.
  - If `warmPool.size > k` → evict the **oldest** entry via `killPty` (only warm, never user-opened).

`markOpened(sessionId)` — graduation: delete from `warmPool`. Called from the /pty resume fast path
(`pty-ws.ts:255`, when `hasLivePty` hits) so a session the user actually opened is no longer counted
or evictable.

Interface kept small: `warmSessionPool()`, `markOpened(key)`. Depends on registry
(`hasLivePty`/`killPty`/exit hook), the §1 helper, binaries (`firstUsableCandidate`/`verifyCocoAsync`),
and `serialize()`.

### 4. Boot wiring — `src/server/index.ts`

After `refresh()` (cache built, `index.ts:73`) and after `server.listen` resolves, call
`warmSessionPool()` **without awaiting** — warming must not delay the listen or block the event loop.
`killAllPtys()` on shutdown (`index.ts:60`) already tears down warm PTYs too.

### 5. Configurable pool size

- `warmPoolSize(): number` reads a settings field `warmPoolSize` (default **6**), with env override
  `BERTH_WARM_POOL` (parsed int, wins when set). `0` disables warming.
- Add `warmPoolSize` to the settings store/schema with default 6. **Settings-page UI is out of scope
  here** — exposing it in the React settings page rides with the broader settings work. Data-layer +
  env knob ship now.

### 6. Loading skeleton — `web/src/components/Terminal.tsx`

- New state `loaded` (init `false`). An absolutely-positioned overlay over the terminal host shows a
  spinner + text while `!loaded`.
- **Hide on first data**: the existing `ws.onmessage` handler (`Terminal.tsx:242`) sets `loaded = true`
  on its first invocation that writes bytes. A server error frame (`[berth] launch failed…`) is also
  a message → overlay clears and reveals the error.
- **Anti-flash**: don't render the overlay until ~150ms have elapsed without data (fast-path
  warm/live opens arrive in ~50ms → user never sees it). Implemented as a `setTimeout(150)` that
  flips a `showOverlay` flag, cleared on first data / unmount.
- Copy: resume mode → "正在恢复会话…"; launch mode (`launch` prop) → "正在启动会话…".
- Extract the timing rule (`should the overlay show, given (elapsed, hasData)`) into a tiny pure
  function for unit testing; the xterm/ws wiring is verified manually.

## Data flow

```
boot:
  refresh() → cache; server.listen() resolves
  └─ warmSessionPool() [not awaited]
       ids = selectWarmSessions(serialize(), k)            # pinned → running → recent, skip live/deleted/no-resume
       for id in ids (concurrency ≤ 2):
         coco? await verifyCocoAsync(bin)                  # slow probe off the click path
         hasLivePty? skip
         spawnAndRegister(s, 120x30) → warmPool.add(id)
         warmPool.size > k → killPty(oldest warm)

open (click, /pty?sessionId=…):
  hasLivePty? ── yes → markOpened(id); attachViewer (instant, fast path)   # warm hit
            └─ no  → spawnAndRegister + attachViewer (cold, 2–5s)          # skeleton shows after 150ms

frontend Terminal:
  mount xterm + open ws; showOverlay after 150ms if no data yet
  first ws.onmessage with data → loaded=true → overlay gone

shutdown: killAllPtys() (existing) kills warm + opened PTYs alike
```

## Testing

- **Unit `selectWarmSessions`**: pinned-first; running before recent; recency desc within tier;
  skips deleted / no-resume / already-live; respects `k`; returns fewer than `k` when few qualify;
  `k = 0` → empty.
- **Unit warm-pool eviction/graduation** (fake registry): exceeding `k` kills the oldest *warm*
  entry and never a user-opened one; `markOpened` removes from the pool; PTY exit drops it.
- **Unit skeleton timing fn**: overlay hidden before 150ms; shown after 150ms with no data; hidden
  once data seen.
- **Refactor safety**: `spawnAndRegister` extraction keeps `npm test` green (existing /pty resume
  coverage).
- **Live (`BERTH_LIVE=1`)**: real cold-resume warming spawns ≤ k PTYs serially; a warmed session's
  open hits the fast path.
- Manual: open a historical coco/claude/codex session → skeleton (not blank) on cold, ~instant on a
  warmed one; confirm warm PTYs are killed on Ctrl-C (no orphaned agents).

## Out of scope

- React settings-page UI for `warmPoolSize` (rides with broader settings work; env + data-layer now).
- Predictive on-hover prefetch and the `web/`-side 20-slot terminal cache (separate follow-ups).
- Persisting scrollback / surviving a server restart with PTYs intact (see ARCHITECTURE "Remaining
  boundary").
