# Server-side read-state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move session read/unread state (the dock red dot) out of per-origin browser `localStorage` into the canonical `~/.berth/berth.sqlite`, so the CLI-launched Berth and the Electron app share it.

**Architecture:** New `session_read` table + an `unread-epoch` setting in the store. Four thin REST endpoints under `/api/read-state`. The frontend `LiveProvider` keeps its in-memory refs and unchanged `LiveState` interface, but seeds them from the server on mount and mirrors every mutation to the server best-effort. A one-time per-origin migration backfills existing `localStorage` read-state into the server.

**Tech Stack:** TypeScript, better-sqlite3, Express (`src/`), React + Vite (`web/`), Vitest (both `test/` and `web/`).

**Spec:** `docs/superpowers/specs/2026-06-27-server-side-read-state-design.md`

---

## File Structure

- **Modify** `src/db/store.ts` — add `session_read` to `SCHEMA`; add `markSeen` / `markUnread` / `readState` / `importReadState` methods to the returned store object.
- **Modify** `test/store.test.ts` — add a `describe('read-state', …)` block.
- **Modify** `src/server/api.ts` — add `GET /read-state`, `POST /read-state/seen`, `POST /read-state/unread`, `POST /read-state/import`.
- **Modify** `web/src/lib/api.ts` — add `readState` / `markSeen` / `markUnread` / `importReadState` client calls.
- **Modify** `web/src/lib/live.tsx` — server-backed refs + mount-time migration & load.
- **Rewrite** `web/src/lib/live.test.tsx` — drive state via mocked `fetch` instead of `localStorage`.

Units: the store owns persistence + merge semantics; the API is a thin pass-through; `live.tsx` owns the optimistic client mirror + migration. `unread.ts` (`contentIsUnread` / `resolveShipStatus`) is **unchanged**.

---

## Task 1: Store — `session_read` table + methods

**Files:**
- Modify: `src/db/store.ts` (the `SCHEMA` string near top; the returned object after the `pin` methods)
- Test: `test/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.ts`:

```ts
describe('read-state', () => {
  it('markSeen upserts max(last_seen) and resets explicit_unread', () => {
    const db = openStore(':memory:')
    db.markUnread('s1')                       // explicit unread first
    db.markSeen(['s1'], 100)                  // seeing clears it + sets last_seen
    db.markSeen(['s1'], 50)                   // older ts must not lower last_seen
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)
    expect(st.unread['s1']).toBeUndefined()
  })

  it('markUnread sets the flag and preserves last_seen', () => {
    const db = openStore(':memory:')
    db.markSeen(['s1'], 100)
    db.markUnread('s1')
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)
    expect(st.unread['s1']).toBe(true)
  })

  it('readState lazily defaults the epoch and persists it', () => {
    const db = openStore(':memory:')
    const first = db.readState().epoch
    expect(first).toBeGreaterThan(0)
    expect(db.readState().epoch).toBe(first)  // stable across calls
  })

  it('importReadState merges max last_seen, OR unread, min epoch', () => {
    const db = openStore(':memory:')
    db.markSeen(['s1'], 100)
    db.readState()                            // forces a server epoch (now, large)
    db.importReadState({ seen: { s1: 50, s2: 200 }, unread: { s3: true }, epoch: 42 })
    const st = db.readState()
    expect(st.lastSeen['s1']).toBe(100)       // max(100, 50)
    expect(st.lastSeen['s2']).toBe(200)
    expect(st.unread['s3']).toBe(true)
    expect(st.epoch).toBe(42)                 // min(now, 42)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/store.test.ts -t read-state`
Expected: FAIL — `db.markSeen is not a function`.

- [ ] **Step 3: Add the table to `SCHEMA`**

In `src/db/store.ts`, inside the `SCHEMA` template string, after the `session_hidden` line, add:

```sql
-- Per-session read state. Server-authoritative (was browser localStorage, which is origin-partitioned
-- so the Electron app and the CLI never shared it). last_seen is unix SECONDS; the unread-epoch
-- baseline lives in app_setting under key 'unread-epoch'. No FK (read state may predate a disk scan).
CREATE TABLE IF NOT EXISTS session_read (
  session_id      TEXT PRIMARY KEY,
  last_seen       INTEGER NOT NULL DEFAULT 0,
  explicit_unread INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 4: Add the store methods**

In `src/db/store.ts`, in the returned object, right after the `allPinnedSet()` method, add:

```ts
    markSeen(ids: string[], ts: number) {
      const stmt = db.prepare(`INSERT INTO session_read (session_id,last_seen,explicit_unread)
        VALUES (?,?,0)
        ON CONFLICT(session_id) DO UPDATE SET
          last_seen=max(last_seen, excluded.last_seen), explicit_unread=0`)
      const tx = db.transaction((rows: string[]) => { for (const id of rows) stmt.run(id, ts) })
      tx(ids)
    },
    markUnread(id: string) {
      db.prepare(`INSERT INTO session_read (session_id,last_seen,explicit_unread) VALUES (?,0,1)
        ON CONFLICT(session_id) DO UPDATE SET explicit_unread=1`).run(id)
    },
    readState(): { lastSeen: Record<string, number>; unread: Record<string, true>; epoch: number } {
      const row = db.prepare(`SELECT value FROM app_setting WHERE key='unread-epoch'`).get() as any
      let epoch = Number(row?.value ?? 0)
      if (!Number.isFinite(epoch) || epoch <= 0) {
        epoch = Math.floor(Date.now() / 1000)
        db.prepare(`INSERT INTO app_setting (key,value) VALUES ('unread-epoch',?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(epoch))
      }
      const lastSeen: Record<string, number> = {}
      const unread: Record<string, true> = {}
      for (const r of db.prepare('SELECT session_id, last_seen, explicit_unread FROM session_read').all() as any[]) {
        if (r.last_seen > 0) lastSeen[r.session_id] = r.last_seen
        if (r.explicit_unread) unread[r.session_id] = true
      }
      return { lastSeen, unread, epoch }
    },
    importReadState(input: { seen?: Record<string, number>; unread?: Record<string, true>; epoch?: number }) {
      const tx = db.transaction(() => {
        const seenStmt = db.prepare(`INSERT INTO session_read (session_id,last_seen,explicit_unread)
          VALUES (?,?,0) ON CONFLICT(session_id) DO UPDATE SET last_seen=max(last_seen, excluded.last_seen)`)
        for (const [id, ts] of Object.entries(input.seen ?? {})) seenStmt.run(id, Number(ts) || 0)
        const unreadStmt = db.prepare(`INSERT INTO session_read (session_id,last_seen,explicit_unread)
          VALUES (?,0,1) ON CONFLICT(session_id) DO UPDATE SET explicit_unread=1`)
        for (const id of Object.keys(input.unread ?? {})) unreadStmt.run(id)
        if (input.epoch && input.epoch > 0) {
          const cur = Number(((db.prepare(`SELECT value FROM app_setting WHERE key='unread-epoch'`).get() as any)?.value) ?? 0)
          const next = cur > 0 ? Math.min(cur, input.epoch) : input.epoch
          db.prepare(`INSERT INTO app_setting (key,value) VALUES ('unread-epoch',?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(next))
        }
      })
      tx()
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/store.test.ts -t read-state`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/db/store.ts test/store.test.ts
git commit -m "feat(read-state): session_read table + store methods"
```

---

## Task 2: REST endpoints

**Files:**
- Modify: `src/server/api.ts` (after the `api.post('/pin', …)` handler)

- [ ] **Step 1: Add the four routes**

In `src/server/api.ts`, immediately after the `/pin` handler block, add:

```ts
// ── Read-state (the dock unread dot). Server-authoritative; replaces per-origin localStorage so the
// CLI browser and the Electron app share it. last_seen is unix SECONDS. ──
api.get('/read-state', (_req, res) => {
  res.json(getStore().readState())
})

api.post('/read-state/seen', (req, res) => {
  const { sessionIds, ts } = req.body ?? {}
  if (!Array.isArray(sessionIds) || !sessionIds.every(x => typeof x === 'string' && x !== ''))
    return res.status(400).json({ error: 'sessionIds:string[] required' })
  const when = typeof ts === 'number' && Number.isFinite(ts) && ts > 0
    ? Math.floor(ts)
    : Math.floor(Date.now() / 1000)
  getStore().markSeen(sessionIds, when)
  res.json({ ok: true })
})

api.post('/read-state/unread', (req, res) => {
  const { sessionId } = req.body ?? {}
  if (typeof sessionId !== 'string' || sessionId === '')
    return res.status(400).json({ error: 'sessionId required' })
  getStore().markUnread(sessionId)
  res.json({ ok: true })
})

api.post('/read-state/import', (req, res) => {
  const { seen, unread, epoch } = req.body ?? {}
  getStore().importReadState({
    seen: seen !== null && typeof seen === 'object' && !Array.isArray(seen) ? seen : {},
    unread: unread !== null && typeof unread === 'object' && !Array.isArray(unread) ? unread : {},
    epoch: typeof epoch === 'number' ? epoch : undefined,
  })
  res.json({ ok: true })
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 3: Smoke-test the endpoints against a running server**

Run (in one shell): `npm start` — note the port (default 7777).
Run (in another): 
```bash
curl -s localhost:7777/api/read-state
curl -s -X POST localhost:7777/api/read-state/seen -H 'Content-Type: application/json' -d '{"sessionIds":["demo"],"ts":123}'
curl -s localhost:7777/api/read-state
```
Expected: first GET returns `{"lastSeen":{},"unread":{},"epoch":<number>}`; after the POST, GET shows `"lastSeen":{"demo":123}`. Stop the server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(read-state): REST endpoints (get/seen/unread/import)"
```

---

## Task 3: Web API client

**Files:**
- Modify: `web/src/lib/api.ts` (the `api` object + an exported type)

- [ ] **Step 1: Add the client calls**

In `web/src/lib/api.ts`, inside the `export const api = { … }` object, after the `saveDoc` entry (last entry), add:

```ts
  // ── Read-state (dock unread dot), server-authoritative. last_seen is unix SECONDS. ──
  readState: () => getJSON<ReadState>('/api/read-state'),
  markSeen: (sessionIds: string[], ts?: number) =>
    send('POST', '/api/read-state/seen', { sessionIds, ts }),
  markUnread: (sessionId: string) =>
    send('POST', '/api/read-state/unread', { sessionId }),
  importReadState: (payload: ReadStateImport) =>
    send('POST', '/api/read-state/import', payload),
```

- [ ] **Step 2: Add the types**

In `web/src/lib/api.ts`, near the other exported interfaces (e.g. above `async function getJSON`), add:

```ts
export interface ReadState {
  lastSeen: Record<string, number>
  unread: Record<string, true>
  epoch: number
}
export interface ReadStateImport {
  seen?: Record<string, number>
  unread?: Record<string, true>
  epoch?: number
}
```

- [ ] **Step 3: Typecheck the web package**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(read-state): web api client calls"
```

---

## Task 4: Rewrite the frontend test (failing spec first)

**Files:**
- Rewrite: `web/src/lib/live.test.tsx`

This task writes the new behavioral spec; Task 5 makes it pass. The tests drive state through a mocked `fetch` (the GET seeds refs; POSTs are asserted) instead of `localStorage`.

- [ ] **Step 1: Replace the whole test file**

Replace the entire contents of `web/src/lib/live.test.tsx` with:

```tsx
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, useLive, type LiveState } from './live'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no WebSocket; LiveProvider opens one on mount. Stub a no-op so the provider mounts.
class FakeWS {
  static last: FakeWS | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() { FakeWS.last = this }
  close() {}
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}
function installMemoryStorage() {
  const storage = createMemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}

// Server read-state the GET will return; mutate per-test before mounting.
let serverState: { lastSeen: Record<string, number>; unread: Record<string, true>; epoch: number }
let posts: Array<{ url: string; body: any }>

function installFetch() {
  posts = []
  ;(globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/read-state')
      return { ok: true, json: async () => serverState } as any
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    return { ok: true, json: async () => ({}) } as any
  })
}

beforeEach(() => {
  ;(globalThis as any).WebSocket = FakeWS
  installMemoryStorage()
  serverState = { lastSeen: {}, unread: {}, epoch: 100 }
  installFetch()
})
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

// Mount and let the mount-effect's async migrate+GET settle.
async function mountLive(): Promise<{ live: () => LiveState; cleanup: () => void }> {
  let latest: LiveState | null = null
  function Probe() { latest = useLive(); return null }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<LiveProvider><Probe /></LiveProvider>) })
  await act(async () => { await Promise.resolve() })
  return {
    live: () => latest!,
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

describe('seed from server on mount', () => {
  it('renders unread for a session newer than the server epoch', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('dock')
    } finally { cleanup() }
  })

  it('renders read for a session the server already marked seen', async () => {
    serverState = { lastSeen: { 'sess-a': 100000 }, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('moored')
    } finally { cleanup() }
  })

  it('renders dock for a server explicit-unread session', async () => {
    serverState = { lastSeen: {}, unread: { 'z': true }, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('z', 0)).toBe('dock')
    } finally { cleanup() }
  })
})

describe('mutations mirror to the server', () => {
  it('markSeenMany flips to read and POSTs the ids', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('dock')
      await act(async () => { live().markSeenMany(['sess-a']) })
      expect(live().shipStatus('sess-a', 100000)).toBe('moored')
      const seen = posts.find(p => p.url === '/api/read-state/seen')
      expect(seen?.body.sessionIds).toEqual(['sess-a'])
    } finally { cleanup() }
  })

  it('markUnread flips to dock and POSTs the id', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markUnread('z') })
      expect(live().shipStatus('z', 0)).toBe('dock')
      expect(posts.find(p => p.url === '/api/read-state/unread')?.body.sessionId).toBe('z')
    } finally { cleanup() }
  })

  it('markSeen clears a prior explicit unread', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markUnread('z') })
      expect(live().shipStatus('z', 0)).toBe('dock')
      await act(async () => { live().markSeen('z') })
      expect(live().shipStatus('z', 0)).toBe('moored')
    } finally { cleanup() }
  })
})

describe('active session stays read', () => {
  it('keeps the active session read when an act frame bumps its updatedAt', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markSeen('open-1') })
      act(() => live().setActiveSession('open-1'))
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'open-1', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('open-1')).toBe('moored')
    } finally { cleanup() }
  })

  it('still marks a non-active session unread when its updatedAt bumps', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markSeen('open-1') })
      act(() => live().setActiveSession('open-1'))
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'other', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('other')).toBe('dock')
    } finally { cleanup() }
  })
})

describe('one-time localStorage migration', () => {
  it('POSTs legacy localStorage read-state to /import once, then sets the guard', async () => {
    localStorage.setItem('berth-last-seen', JSON.stringify({ a: 500 }))
    localStorage.setItem('berth-unread', JSON.stringify({ b: true }))
    localStorage.setItem('berth-unread-epoch', '42')
    const { cleanup } = await mountLive()
    try {
      const imp = posts.find(p => p.url === '/api/read-state/import')
      expect(imp?.body).toEqual({ seen: { a: 500 }, unread: { b: true }, epoch: 42 })
      expect(localStorage.getItem('berth-read-migrated')).toBe('1')
    } finally { cleanup() }
  })

  it('does not migrate when there is no legacy localStorage', async () => {
    const { cleanup } = await mountLive()
    try {
      expect(posts.find(p => p.url === '/api/read-state/import')).toBeUndefined()
    } finally { cleanup() }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/live.test.tsx; cd ..`
Expected: FAIL — the current `live.tsx` doesn't call `fetch`, so the seed/mutation/migration assertions fail (e.g. `posts` empty, no `/import`).

---

## Task 5: Rewrite `live.tsx` to be server-backed

**Files:**
- Modify: `web/src/lib/live.tsx`

- [ ] **Step 1: Add the import + migration helper**

At the top of `web/src/lib/live.tsx`, add the api import after the existing imports:

```ts
import { api } from './api'
```

Then, after the `UNREAD_KEY` constant (`const UNREAD_KEY = 'berth-unread'`), add the migration constants/helper and remove `loadUnreadEpoch` (it is replaced by the server epoch):

```ts
const MIGRATED_KEY = 'berth-read-migrated'

// One-time, per-origin: push any legacy localStorage read-state up to the server, then never again.
// Returns once the import POST (if any) has been attempted.
async function migrateLegacyReadState(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return
    const seen = loadJson<Record<string, number>>(SEEN_KEY, {})
    const unread = loadJson<Record<string, true>>(UNREAD_KEY, {})
    const epochRaw = Number(localStorage.getItem(UNREAD_EPOCH_KEY) || 0)
    const epoch = Number.isFinite(epochRaw) && epochRaw > 0 ? epochRaw : undefined
    const hasLegacy = Object.keys(seen).length > 0 || Object.keys(unread).length > 0 || epoch !== undefined
    if (hasLegacy) await api.importReadState({ seen, unread, epoch })
    localStorage.setItem(MIGRATED_KEY, '1')
  } catch { /* best-effort: a failed migration just retries on the next load */ }
}
```

Delete the now-unused `loadUnreadEpoch` function.

- [ ] **Step 2: Make the refs server-seeded, not localStorage-seeded**

Replace these four ref initializers:

```ts
  const seen = useRef<Record<string, number>>(loadJson(SEEN_KEY, {}))
  const unread = useRef<Record<string, boolean>>(loadJson(UNREAD_KEY, {}))
  const unreadEpoch = useRef(loadUnreadEpoch())
```

with:

```ts
  const seen = useRef<Record<string, number>>({})
  const unread = useRef<Record<string, boolean>>({})
  const unreadEpoch = useRef(0)
```

- [ ] **Step 3: Load read-state from the server on mount**

Add a new effect after the `setActiveSession` `useCallback` and before the existing WS `useEffect` (it must come after `const bump = …` is declared, since it calls `bump()`):

```ts
  // Seed read-state from the server (migrating any legacy localStorage first). Server is the source
  // of truth now — origin-independent, so the CLI browser and the Electron app share unread markers.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await migrateLegacyReadState()
      try {
        const st = await api.readState()
        if (cancelled) return
        seen.current = { ...st.lastSeen }
        unread.current = Object.fromEntries(Object.keys(st.unread).map((k) => [k, true]))
        unreadEpoch.current = st.epoch
        bump()
      } catch { /* offline / failed GET → leave refs empty (everything moored); reload re-fetches */ }
    })()
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 4: Mirror mutations to the server**

Rewrite the `markSeen`, `markSeenMany`, `markUnread` methods in the returned `value` object, and the active-session sync branch, to POST. Replace `markSeen`:

```ts
    markSeen: (sessionId) => {
      const now = Math.floor(Date.now() / 1000)
      seen.current[sessionId] = now
      if (unread.current[sessionId]) delete unread.current[sessionId]
      void api.markSeen([sessionId], now).catch(() => {})
      bump()
    },
```

Replace `markSeenMany`:

```ts
    markSeenMany: (sessionIds) => {
      if (sessionIds.length === 0) return
      const now = Math.floor(Date.now() / 1000)
      for (const id of sessionIds) {
        seen.current[id] = now
        if (unread.current[id]) delete unread.current[id]
      }
      void api.markSeen(sessionIds, now).catch(() => {})
      bump()
    },
```

Replace `markUnread`:

```ts
    markUnread: (sessionId) => {
      unread.current[sessionId] = true
      void api.markUnread(sessionId).catch(() => {})
      bump()
    },
```

In the WS `onmessage` handler, replace the active-session localStorage write block (the `if (activeSession.current === m.sessionId) { … localStorage.setItem(SEEN_KEY, …) }`) with:

```ts
            if (activeSession.current === m.sessionId) {
              const next = Math.max(seen.current[m.sessionId] ?? 0, m.updatedAt)
              seen.current[m.sessionId] = next
              void api.markSeen([m.sessionId], next).catch(() => {})
            }
```

- [ ] **Step 5: Remove the now-dead localStorage writes**

Confirm no remaining `localStorage.setItem(SEEN_KEY …)` / `localStorage.setItem(UNREAD_KEY …)` calls exist in `live.tsx` (they were all inside the methods rewritten above). The `loadJson` helper stays (used by the migration). `SEEN_KEY`, `UNREAD_KEY`, `UNREAD_EPOCH_KEY` stay (migration reads them).

Run: `grep -n "localStorage.setItem" web/src/lib/live.tsx`
Expected: only the `localStorage.setItem(MIGRATED_KEY, '1')` line inside `migrateLegacyReadState`.

- [ ] **Step 6: Run the frontend tests to verify they pass**

Run: `cd web && npx vitest run src/lib/live.test.tsx; cd ..`
Expected: PASS (all describe blocks).

- [ ] **Step 7: Typecheck both packages**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/live.tsx web/src/lib/live.test.tsx
git commit -m "feat(read-state): server-backed LiveProvider + localStorage migration"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run both test suites**

Run: `npm test && cd web && npx vitest run; cd ..`
Expected: both green.

- [ ] **Step 2: Manual end-to-end across two origins**

Run: `npm start` (serves `127.0.0.1:7777`). In the browser, mark a session read; confirm the dot clears.
Then simulate the app origin by opening `http://localhost:7777/app/` (different host = different localStorage) — the read state should still be present (served from the store), confirming origin-independence.
Stop the server.

- [ ] **Step 3: Final typecheck**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: clean. (Per CLAUDE.md: never commit on a broken build.)

---

## Self-review notes

- **Spec coverage:** data model (Task 1) ✓, REST (Task 2) ✓, web client (Task 3) ✓, frontend + migration (Tasks 4–5) ✓, testing (Tasks 1, 4–6) ✓. Out-of-scope items (live WS sync, auth) intentionally absent.
- **API-level tests:** no supertest/app harness exists in `test/`; endpoints are thin pass-throughs to store methods that ARE unit-tested (Task 1) + smoke-tested via curl (Task 2 Step 3), matching the spec's "store-level tests carry it."
- **Type consistency:** `markSeen(ids: string[], ts: number)` (store) ↔ `api.markSeen(sessionIds, ts?)` (client) ↔ `POST /read-state/seen {sessionIds, ts?}` (server) all agree on shape and the SECONDS unit. `ReadState` / `ReadStateImport` shapes match `readState()` / `importReadState()`.
