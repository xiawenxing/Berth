# Codex task↔session Bind Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a codex session launched from a task bind to that task **at session start, durably (edge on disk), and exactly** — like claude/coco — instead of an eventually-consistent 40s-window reconcile that intermittently drops the link after a kill+restart.

**Architecture:** Add two complementary, idempotent binding channels that both write the same durable `edge` the moment codex starts: **(A)** the existing codex SessionStart hook dumps codex's launch envelope (which carries the real `session_id`) to a token-named callback file that Berth watches; **(B)** a fallback that watches the codex rollout dir for the new `session_meta` line. The legacy 40s `watchCodexFirstTurn`/`reconcileLaunchIntents` stays as a last-ditch fallback. A separate P2 sweep clears dangling claude/coco edges whose session never materialized.

**Tech Stack:** Node 20, TypeScript ESM, `better-sqlite3`, `node:fs` (`fs.watch`), `vitest`. Pure functions with injected deps (the repo's established testable style); thin server glue in `src/server/`.

**Spec:** `docs/superpowers/specs/2026-06-27-codex-bind-reliability-design.md` (root cause, probe results, locked decisions).

---

## File Structure

**New files:**
- `src/server/bind.ts` — pure `bindIntentToSession(store, intent, sessionId)`: the store-write half of a bind (edge + attach + bindIntent), shared by reconcile + both new channels.
- `src/server/launch-callback.ts` — pure `parseLaunchCallback(raw)`: validate codex's SessionStart envelope JSON → `{sessionId, cwd}`.
- `src/server/launch-callback-watch.ts` — server glue: watch `$BERTH_HOME/launch-callbacks/`, parse, bind by token (=filename), delete file; + startup scan.
- `src/server/rollout-match.ts` — pure `parseSessionMeta(firstLine)` + `matchRolloutToIntent(intents, rollout, windowSec)`.
- `src/server/rollout-watch.ts` — server glue: watch today's codex `sessions/YYYY/MM/DD/` dir (armed only while pending codex intents exist), 5s coarse poll fallback.
- `src/server/orphan-sweep.ts` — pure `selectOrphanLaunches(bound, opts)`: ids of dangling bound launches to drop.

**Modified files:**
- `src/server/reconcile.ts` — use the shared `bindIntentToSession` (no behavior change).
- `src/pty/launch.ts` — extend `ensureCodexBerthHookProfile` (envelope→callback file) + inject `BERTH_LAUNCH_TOKEN`/`BERTH_CALLBACK_DIR` env.
- `src/server/store-singleton.ts` — wire callback watcher + rollout watcher + orphan sweep into startup/`refresh()`.

**New test files (in `test/`):** `bind.test.ts`, `launch-callback.test.ts`, `rollout-match.test.ts`, `orphan-sweep.test.ts`. (Watcher glue is covered by the pure fns + one live assertion noted at the end.)

---

## Task 1: Shared pure bind helper

Extract reconcile's store-write block into one pure function so all three channels bind identically.

**Files:**
- Create: `src/server/bind.ts`
- Test: `test/bind.test.ts`
- Modify: `src/server/reconcile.ts:61-68`

- [ ] **Step 1: Write the failing test**

```typescript
// test/bind.test.ts
import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { bindIntentToSession } from '../src/server/bind'
import type { LaunchIntent } from '../src/types'

function intent(over: Partial<LaunchIntent> = {}): LaunchIntent {
  return { id: 'i1', cli: 'codex', cwd: '/proj', projectId: null, todoKey: null, sessionId: null, createdAt: 1000, bound: false, ...over }
}

describe('bindIntentToSession', () => {
  it('writes edge + attach + marks the intent bound', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: 'task-A', projectId: 'P' }))
    bindIntentToSession(s, intent({ todoKey: 'task-A', projectId: 'P' }), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBe('task-A')
    expect(s.getAttach('real-sid')).toMatchObject({ projectId: 'P', state: 'confirmed' })
    expect(s.pendingIntents()).toEqual([])
  })

  it('skips edge when todoKey is null and skips attach when projectId is null', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent())
    bindIntentToSession(s, intent(), 'real-sid')
    expect(s.todoKeyForSession('real-sid')).toBeNull()
    expect(s.getAttach('real-sid')).toBeNull()
    expect(s.allBoundLaunchSessionIds().has('real-sid')).toBe(true)
  })

  it('is idempotent — binding the same pair twice writes one edge', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent(intent({ todoKey: 'task-A' }))
    bindIntentToSession(s, intent({ todoKey: 'task-A' }), 'real-sid')
    bindIntentToSession(s, intent({ todoKey: 'task-A' }), 'real-sid')
    expect(s.edgesByTodo().get('task-A')).toEqual(['real-sid'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bind.test.ts`
Expected: FAIL — `Cannot find module '../src/server/bind'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/bind.ts
import type { openStore } from '../db/store'
import type { LaunchIntent } from '../types'

type Store = ReturnType<typeof openStore>

/**
 * The store-write half of binding a launch intent to a real session id: edge (if task-bound),
 * attach (only for a REAL project — a null-project attach has no consumer and mis-curates), and
 * mark the intent bound. Idempotent (addEdge is INSERT OR IGNORE; bindIntent is a plain UPDATE).
 * Pure w.r.t. the pty-registry — callers do rekeyPty/logDiag themselves.
 */
export function bindIntentToSession(store: Store, intent: LaunchIntent, sessionId: string): void {
  if (intent.todoKey !== null) store.addEdge(intent.todoKey, sessionId)
  if (intent.projectId) store.setAttach(sessionId, intent.projectId, 'confirmed')
  store.bindIntent(intent.id, sessionId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bind.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor reconcile.ts to use it**

In `src/server/reconcile.ts`, replace lines 61-68:

```typescript
    if (intent.todoKey !== null) {
      // intent.todoKey is a Berth task id (post identity-migration), used directly as the edge key.
      store.addEdge(intent.todoKey, best.sessionId)
    }
    // Only attach to a real project. Project-less codex launches still surface through the bound
    // launch intent; writing a null-project attach makes the frontend classify them as unassigned.
    if (intent.projectId) store.setAttach(best.sessionId, intent.projectId, 'confirmed')
    store.bindIntent(intent.id, best.sessionId)
```

with:

```typescript
    bindIntentToSession(store, intent, best.sessionId)
```

and add the import at the top of `reconcile.ts` (next to the existing imports):

```typescript
import { bindIntentToSession } from './bind'
```

- [ ] **Step 6: Run the full reconcile + bind suites to verify no behavior change**

Run: `npx vitest run test/reconcile.test.ts test/bind.test.ts`
Expected: PASS (all reconcile tests still green + 3 bind tests).

- [ ] **Step 7: Commit**

```bash
git add src/server/bind.ts test/bind.test.ts src/server/reconcile.ts
git commit -m "refactor(launch): extract pure bindIntentToSession shared by reconcile + new channels"
```

---

## Task 2: Channel A — parse the codex SessionStart callback envelope

Pure validation of the raw JSON envelope codex passes its SessionStart hook (probe-confirmed shape).

**Files:**
- Create: `src/server/launch-callback.ts`
- Test: `test/launch-callback.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/launch-callback.test.ts
import { describe, it, expect } from 'vitest'
import { parseLaunchCallback } from '../src/server/launch-callback'

// The real envelope captured from codex 0.142.0's SessionStart hook stdin (see spec, probe results).
const REAL = JSON.stringify({
  session_id: '019f076d-94d2-7570-b442-82dfc6604c20',
  transcript_path: '/Users/x/.codex/sessions/2026/06/27/rollout-...-019f076d-....jsonl',
  cwd: '/private/tmp/codex-probe/cwd',
  hook_event_name: 'SessionStart',
  permission_mode: 'bypassPermissions',
  source: 'startup',
})

describe('parseLaunchCallback', () => {
  it('extracts sessionId + cwd from a real SessionStart envelope', () => {
    expect(parseLaunchCallback(REAL)).toEqual({
      sessionId: '019f076d-94d2-7570-b442-82dfc6604c20',
      cwd: '/private/tmp/codex-probe/cwd',
    })
  })

  it('returns null for non-JSON, empty, or a wrong event', () => {
    expect(parseLaunchCallback('not json')).toBeNull()
    expect(parseLaunchCallback('')).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', cwd: '/y' }))).toBeNull()
  })

  it('returns null when session_id or cwd is missing', () => {
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', cwd: '/y' }))).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'x' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/launch-callback.test.ts`
Expected: FAIL — `Cannot find module '../src/server/launch-callback'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/launch-callback.ts

/** Validated SessionStart callback: the real codex session id + the cwd codex recorded. The launch
 *  token is NOT in the envelope — it comes from the callback FILE NAME (the hook writes the envelope
 *  to <token>.json). */
export interface LaunchCallback {
  sessionId: string
  cwd: string
}

/**
 * Parse codex's SessionStart hook envelope (the raw JSON the hook received on stdin and dumped to the
 * callback file). Returns null for anything malformed or not a SessionStart event — logging never
 * throws into the bind path.
 */
export function parseLaunchCallback(raw: string): LaunchCallback | null {
  let obj: any
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || obj.hook_event_name !== 'SessionStart') return null
  const sessionId = obj.session_id
  const cwd = obj.cwd
  if (typeof sessionId !== 'string' || !sessionId) return null
  if (typeof cwd !== 'string' || !cwd) return null
  return { sessionId, cwd }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/launch-callback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/launch-callback.ts test/launch-callback.test.ts
git commit -m "feat(launch): parse codex SessionStart callback envelope (channel A)"
```

---

## Task 3: Channel A — extend the codex hook profile + inject env

Make the SessionStart hook ALSO dump its stdin envelope to a token-named callback file, and inject the token + callback dir into the codex launch env.

**Files:**
- Modify: `src/pty/launch.ts:220-233` (`ensureCodexBerthHookProfile`)
- Modify: `src/pty/launch.ts:250-254` (env injection in `launchFresh`)
- Test: `test/launch.test.ts` (append cases)

- [ ] **Step 1: Write the failing test**

Append to `test/launch.test.ts` (top-level imports already include the launch module — add `ensureCodexBerthHookProfile` and `codexCallbackDir` to the existing import from `../src/pty/launch`):

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('codex SessionStart hook → callback file (channel A)', () => {
  it('generated profile writes the stdin envelope to $BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json', () => {
    // ensureCodexBerthHookProfile writes ~/.codex/berth-launch.config.toml; assert the command shape.
    ensureCodexBerthHookProfile()
    const toml = readFileSync(join(process.env.CODEX_HOME || '', 'berth-launch.config.toml'), 'utf8')
    // The hook must (a) drop the raw envelope to the token-named callback file, and (b) still cat the
    // context file to stdout (context injection must not regress).
    expect(toml).toContain('$BERTH_CALLBACK_DIR')
    expect(toml).toContain('$BERTH_LAUNCH_TOKEN')
    expect(toml).toContain('$BERTH_CONTEXT_FILE')
  })
})
```

> Note: this test sets `CODEX_HOME` to a temp dir in a `beforeEach` so it never touches the real `~/.codex`. If `test/launch.test.ts` does not already isolate `CODEX_HOME`, add at the top of this `describe`:
> ```typescript
> let tmpHome = ''
> beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), 'berth-codexhome-')); process.env.CODEX_HOME = tmpHome })
> afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); delete process.env.CODEX_HOME })
> ```
> (import `mkdtempSync, rmSync` from `node:fs`, `tmpdir` from `node:os`, `beforeEach, afterEach` from `vitest`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/launch.test.ts -t 'channel A'`
Expected: FAIL — current TOML has no `$BERTH_CALLBACK_DIR`/`$BERTH_LAUNCH_TOKEN`.

- [ ] **Step 3: Implement the profile + env changes**

In `src/pty/launch.ts`, replace `ensureCodexBerthHookProfile` (lines 220-233) with:

```typescript
/** Directory under BERTH_HOME where SessionStart hooks drop their launch-callback envelopes. */
export function codexCallbackDir(): string {
  return join(berthHome(), 'launch-callbacks')
}

export function ensureCodexBerthHookProfile() {
  const home = codexHome()
  mkdirSync(home, { recursive: true })
  // The hook does two things, order matters:
  //   1. Consume stdin (codex's SessionStart envelope: {session_id, cwd, hook_event_name, ...}) and
  //      drop it RAW to $BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json — Berth parses it in TS (no jq
  //      in the hook's narrow PATH). The file NAME carries the launch token → exact intent match.
  //   2. cat $BERTH_CONTEXT_FILE to STDOUT — codex injects hook stdout as context (must not regress).
  // Both env vars are injected by launchFresh. If the callback dir/token is unset (a non-Berth codex
  // run reusing this profile — shouldn't happen, but be safe), the drop is skipped and only context
  // injection runs.
  writeFileSync(join(home, `${CODEX_BERTH_PROFILE}.config.toml`), `# Generated by Berth. Loaded with: codex --profile ${CODEX_BERTH_PROFILE}
[[hooks.SessionStart]]
matcher = "startup"

[[hooks.SessionStart.hooks]]
type = "command"
command = "/bin/sh -c 'payload=$(cat); if [ -n \\"$BERTH_CALLBACK_DIR\\" ] && [ -n \\"$BERTH_LAUNCH_TOKEN\\" ]; then mkdir -p \\"$BERTH_CALLBACK_DIR\\"; printf %s \\"$payload\\" > \\"$BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json\\"; fi; test -n \\"$BERTH_CONTEXT_FILE\\" && test -r \\"$BERTH_CONTEXT_FILE\\" && cat \\"$BERTH_CONTEXT_FILE\\" || true'"
timeout = 5
statusMessage = "Loading Berth context"
`)
}
```

Then in `launchFresh`, where codex env is set (lines 250-254), after `env.BERTH_CONTEXT_FILE = opts.injectFile` add the token + dir. Replace:

```typescript
  const env = { ...(process.env as any) }
  if (cli === 'codex' && opts.injectFile) {
    ensureCodexBerthHookProfile()
    env.BERTH_CONTEXT_FILE = opts.injectFile            // codex hook cats raw text as context
  }
```

with:

```typescript
  const env = { ...(process.env as any) }
  if (cli === 'codex' && opts.injectFile) {
    ensureCodexBerthHookProfile()
    env.BERTH_CONTEXT_FILE = opts.injectFile            // codex hook cats raw text as context
    // Channel A: the SessionStart hook drops codex's envelope (real session_id) to <token>.json so
    // Berth binds the task↔session edge the moment codex starts — token = the launch intent id.
    if (opts.sessionId === undefined && opts.launchToken) {
      env.BERTH_LAUNCH_TOKEN = opts.launchToken
      env.BERTH_CALLBACK_DIR = codexCallbackDir()
    }
  }
```

> `opts.sessionId === undefined` is always true for codex (only claude/coco pre-mint), kept explicit
> for clarity. Add `launchToken?: string` to the `FreshOpts` interface (near line 72, alongside
> `cwd`/`sessionId`/`injectFile`).

- [ ] **Step 4: Pass the launch token from the codex launch site**

In `src/server/pty-ws.ts`, in the `freshOpts` object (lines 520-529, the non-stream/TUI branch), add the token for codex:

```typescript
    const freshOpts = {
      cwd,
      sessionId: plan.sessionId ?? undefined,
      injectFile,
      initialPrompt: initialPrompt ?? undefined,
      model: agentEntry.model ?? undefined,
      addDirs: finalAddDirs,
      cols,
      rows,
      launchToken: cli === 'codex' ? plan.intent.id : undefined,  // channel A: token = intent id
    }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run test/launch.test.ts -t 'channel A'` → PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/pty/launch.ts src/server/pty-ws.ts test/launch.test.ts
git commit -m "feat(launch): codex SessionStart hook drops launch-callback envelope + inject token/dir (channel A)"
```

---

## Task 4: Channel A — bind from a parsed callback

Pure-ish glue: given a token (=intent id) and a parsed callback, find the pending codex intent and bind it (reusing Task 1's helper), then rekey the pty.

**Files:**
- Create: `src/server/launch-callback-watch.ts` (the `ingestCallback` function only in this task; the fs.watch wiring is Task 5)
- Test: `test/launch-callback.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/launch-callback.test.ts`:

```typescript
import { openStore } from '../src/db/store'
import { ingestCallback } from '../src/server/launch-callback-watch'

describe('ingestCallback', () => {
  it('binds the pending codex intent named by the token', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'tok-1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
    const rekeyed: Array<[string, string]> = []
    const ok = ingestCallback(s, 'tok-1', { sessionId: 'real-sid', cwd: '/proj' }, { rekey: (a, b) => rekeyed.push([a, b]) })
    expect(ok).toBe(true)
    expect(s.todoKeyForSession('real-sid')).toBe('task-A')
    expect(s.pendingIntents()).toEqual([])
    expect(rekeyed).toEqual([['tok-1', 'real-sid']])
  })

  it('no-ops for an unknown token or an already-bound intent', () => {
    const s = openStore(':memory:')
    expect(ingestCallback(s, 'missing', { sessionId: 'x', cwd: '/p' }, { rekey: () => {} })).toBe(false)
    s.addLaunchIntent({ id: 'tok-2', cli: 'codex', cwd: '/proj', projectId: null, todoKey: null, sessionId: 'already', createdAt: 1000, bound: true })
    expect(ingestCallback(s, 'tok-2', { sessionId: 'real', cwd: '/proj' }, { rekey: () => {} })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/launch-callback.test.ts -t ingestCallback`
Expected: FAIL — `Cannot find module '../src/server/launch-callback-watch'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/launch-callback-watch.ts
import type { openStore } from '../db/store'
import type { LaunchCallback } from './launch-callback'
import { bindIntentToSession } from './bind'

type Store = ReturnType<typeof openStore>

/**
 * Bind a codex launch from its SessionStart callback. `token` is the launch intent id (the callback
 * file is named <token>.json). Returns true iff a pending intent named by the token was bound.
 * `rekey` moves the live pty from the intent id to the real session id (injected for testability).
 */
export function ingestCallback(
  store: Store,
  token: string,
  cb: LaunchCallback,
  deps: { rekey: (oldKey: string, newKey: string) => void },
): boolean {
  const intent = store.pendingIntents().find(i => i.id === token && i.cli === 'codex')
  if (!intent) return false
  bindIntentToSession(store, intent, cb.sessionId)
  deps.rekey(intent.id, cb.sessionId)
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/launch-callback.test.ts -t ingestCallback`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/launch-callback-watch.ts test/launch-callback.test.ts
git commit -m "feat(launch): bind codex launch from SessionStart callback by token (channel A)"
```

---

## Task 5: Channel A — watch the callback dir + startup scan (server wiring)

Wire `ingestCallback` to the filesystem: watch `$BERTH_HOME/launch-callbacks/`, process new `*.json` files, delete after binding; scan existing files at startup (covers a callback dropped while Berth was down).

**Files:**
- Modify: `src/server/launch-callback-watch.ts` (add `startLaunchCallbackWatch` + `scanLaunchCallbacks`)
- Modify: `src/server/store-singleton.ts` (call them from startup)

- [ ] **Step 1: Add the watcher + scanner (no new unit test — fs.watch glue; correctness is in Task 4's pure `ingestCallback` + the live assertion at the end)**

Append to `src/server/launch-callback-watch.ts`:

```typescript
import { mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import { rekeyPty } from './pty-registry'
import { logDiag } from './diag'
import { parseLaunchCallback } from './launch-callback'

/** Process one callback file (named <token>.json): parse, bind, delete. Best-effort — never throws. */
function processCallbackFile(store: Store, dir: string, file: string): void {
  if (!file.endsWith('.json')) return
  const token = file.slice(0, -'.json'.length)
  const path = join(dir, file)
  try {
    const cb = parseLaunchCallback(readFileSync(path, 'utf8'))
    if (cb) {
      const bound = ingestCallback(store, token, cb, { rekey: rekeyPty })
      if (bound) logDiag({ category: 'reconcile', event: 'callback_bind', sessionId: cb.sessionId, cli: 'codex', intentId: token })
    }
  } catch { /* transient (partial write / parse) — leave the file; next event/scan retries */ }
  // Delete only on a successful parse+bind path; a malformed file is left for inspection but a bound
  // one is removed so the dir stays small. Re-read to decide:
  try { if (parseLaunchCallback(readFileSync(path, 'utf8'))) rmSync(path, { force: true }) } catch {}
}

/** Scan any callback files already on disk (dropped while Berth was down). Call once at startup. */
export function scanLaunchCallbacks(store: Store, dir: string): void {
  try { mkdirSync(dir, { recursive: true }) } catch {}
  let files: string[] = []
  try { files = readdirSync(dir) } catch { return }
  for (const f of files) processCallbackFile(store, dir, f)
}

/** Watch the callback dir for new drops. Returns a stop fn. macOS fires 'rename' on create. */
export function startLaunchCallbackWatch(store: Store, dir: string): () => void {
  try { mkdirSync(dir, { recursive: true }) } catch {}
  const w = watch(dir, (_event, filename) => {
    if (filename) processCallbackFile(store, dir, filename.toString())
  })
  ;(w as { unref?: () => void }).unref?.()
  return () => w.close()
}
```

- [ ] **Step 2: Wire into startup in `store-singleton.ts`**

In `src/server/store-singleton.ts`, add imports near the top:

```typescript
import { scanLaunchCallbacks, startLaunchCallbackWatch } from './launch-callback-watch'
import { codexCallbackDir } from '../pty/launch'
```

At the end of `initData()` (after the migrations, before it returns), add:

```typescript
  // Channel A: pick up any callbacks dropped while Berth was down, then watch for new ones.
  const cbDir = codexCallbackDir()
  scanLaunchCallbacks(store, cbDir)
  startLaunchCallbackWatch(store, cbDir)
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → all green (no regressions; new watcher has no unit test but must not break existing).

- [ ] **Step 4: Commit**

```bash
git add src/server/launch-callback-watch.ts src/server/store-singleton.ts
git commit -m "feat(launch): watch launch-callbacks dir + startup scan (channel A wiring)"
```

---

## Task 6: Channel B — parse session_meta + window-match to an intent (pure)

The hook-independent fallback's two pure cores: read a rollout's first line, and correlate it to a pending intent within the 90s window.

**Files:**
- Create: `src/server/rollout-match.ts`
- Test: `test/rollout-match.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/rollout-match.test.ts
import { describe, it, expect } from 'vitest'
import { parseSessionMeta, matchRolloutToIntent } from '../src/server/rollout-match'

// Real session_meta first line from codex 0.142.0 (see spec probe).
const META = JSON.stringify({
  timestamp: '2026-06-27T04:35:33.844Z',
  type: 'session_meta',
  payload: { session_id: '019f075c-…', cwd: '/proj', timestamp: '2026-06-27T04:35:27.374Z' },
})

describe('parseSessionMeta', () => {
  it('extracts sessionId, cwd, and the payload start time in epoch seconds', () => {
    const r = parseSessionMeta(META)
    expect(r?.sessionId).toBe('019f075c-…')
    expect(r?.cwd).toBe('/proj')
    expect(r?.startedAtSec).toBe(Math.floor(Date.parse('2026-06-27T04:35:27.374Z') / 1000))
  })
  it('returns null for non-session_meta or malformed lines', () => {
    expect(parseSessionMeta('nope')).toBeNull()
    expect(parseSessionMeta(JSON.stringify({ type: 'event_msg', payload: {} }))).toBeNull()
  })
})

describe('matchRolloutToIntent (Δ=90s, earliest in window)', () => {
  const intents = [
    { id: 'i-early', cwd: '/proj', createdAt: 1000 },
    { id: 'i-late', cwd: '/proj', createdAt: 1050 },
    { id: 'i-other', cwd: '/elsewhere', createdAt: 1000 },
  ]
  it('matches the earliest same-cwd intent whose window contains the rollout start', () => {
    // rollout starts at 1005 — inside both i-early[1000,1090] and i-late[1050,1140]? 1005<1050 so only i-early.
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1005 }, 90)).toBe('i-early')
  })
  it('picks the earliest-createdAt intent when several windows overlap the rollout', () => {
    // rollout at 1060 ∈ i-early[1000,1090] AND i-late[1050,1140] → earliest createdAt wins.
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1060 }, 90)).toBe('i-early')
  })
  it('returns null when cwd differs or the rollout is outside every window', () => {
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 2000 }, 90)).toBeNull()
    expect(matchRolloutToIntent(intents, { cwd: '/nowhere', startedAtSec: 1005 }, 90)).toBeNull()
  })
  it('rejects a rollout that started BEFORE the intent (clock: session starts after launch)', () => {
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 990 }, 90)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rollout-match.test.ts`
Expected: FAIL — `Cannot find module '../src/server/rollout-match'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/rollout-match.ts
import { canonicalPathKey } from '../path-normalize'

export interface RolloutMeta { sessionId: string; cwd: string; startedAtSec: number }
export interface PendingIntentLite { id: string; cwd: string; createdAt: number }

/** Parse a codex rollout's first line — the `session_meta` record — into {sessionId, cwd, startedAt}.
 *  Null for any other line shape. `payload.timestamp` is the session's own start time (ISO). */
export function parseSessionMeta(firstLine: string): RolloutMeta | null {
  let obj: any
  try { obj = JSON.parse(firstLine) } catch { return null }
  if (!obj || obj.type !== 'session_meta' || !obj.payload) return null
  const p = obj.payload
  if (typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null
  const ts = Date.parse(p.timestamp ?? obj.timestamp ?? '')
  if (Number.isNaN(ts)) return null
  return { sessionId: p.session_id, cwd: p.cwd, startedAtSec: Math.floor(ts / 1000) }
}

/**
 * Find the pending codex intent a new rollout belongs to: same cwd (path-normalized) AND the rollout
 * start time within [intent.createdAt, intent.createdAt + windowSec]. When several windows overlap,
 * the EARLIEST-createdAt intent wins (it launched first, so its session surfaced first). Returns the
 * intent id, or null. Channel A's launchToken corrects any genuine ambiguity; this is the guaranteed
 * fallback, so it errs toward matching.
 */
export function matchRolloutToIntent(
  intents: PendingIntentLite[],
  rollout: { cwd: string; startedAtSec: number },
  windowSec = 90,
): string | null {
  const rc = canonicalPathKey(rollout.cwd)
  const candidates = intents
    .filter(i => canonicalPathKey(i.cwd) === rc)
    .filter(i => rollout.startedAtSec >= i.createdAt && rollout.startedAtSec <= i.createdAt + windowSec)
    .sort((a, b) => a.createdAt - b.createdAt)
  return candidates[0]?.id ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rollout-match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/rollout-match.ts test/rollout-match.test.ts
git commit -m "feat(launch): parse session_meta + window-match rollout→intent (channel B core, Δ=90s)"
```

---

## Task 7: Channel B — watch today's rollout dir (server wiring)

Watch `~/.codex/sessions/YYYY/MM/DD/` for new rollout files, but only while there is a pending codex intent; re-point the watch at midnight; 5s coarse poll fallback. On a new rollout, read its first line, `matchRolloutToIntent`, and bind via `bindIntentToSession` + `rekeyPty`.

**Files:**
- Create: `src/server/rollout-watch.ts`
- Modify: `src/server/store-singleton.ts` (arm/disarm from `refresh()`)

- [ ] **Step 1: Add a pure helper for the day-dir path + the bind-from-rollout glue (unit-tested)**

Create `src/server/rollout-watch.ts`:

```typescript
import { existsSync, readdirSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { rekeyPty } from './pty-registry'
import { logDiag } from './diag'
import { bindIntentToSession } from './bind'
import { parseSessionMeta, matchRolloutToIntent } from './rollout-match'
import type { openStore } from '../db/store'

type Store = ReturnType<typeof openStore>

export const ROLLOUT_POLL_MS = 5_000   // coarse fallback — see spec decision 4 (do NOT shrink: perf)

/** The codex rollout dir for a given Date: <codexHome>/sessions/YYYY/MM/DD. Pure (date injected). */
export function rolloutDayDir(now: Date, codexHome = join(homedir(), '.codex')): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return join(codexHome, 'sessions', String(y), m, d)
}

/** Read a rollout file's first line and bind it to a pending intent if it matches. Best-effort. */
export function bindFromRollout(store: Store, path: string): boolean {
  let meta = null as ReturnType<typeof parseSessionMeta>
  try { meta = parseSessionMeta(readFileSync(path, 'utf8').split('\n', 1)[0] ?? '') } catch { return false }
  if (!meta) return false
  const pending = store.pendingIntents().filter(i => i.cli === 'codex')
  const id = matchRolloutToIntent(pending, { cwd: meta.cwd, startedAtSec: meta.startedAtSec }, 90)
  if (!id) return false
  const intent = pending.find(i => i.id === id)!
  bindIntentToSession(store, intent, meta.sessionId)
  rekeyPty(intent.id, meta.sessionId)
  logDiag({ category: 'reconcile', event: 'rollout_bind', sessionId: meta.sessionId, cli: 'codex', intentId: intent.id })
  return true
}

let watcher: { close(): void } | null = null
let poll: ReturnType<typeof setInterval> | null = null
let watchedDir = ''

/** Arm the rollout watch IFF there is a pending codex intent; disarm otherwise. Idempotent — safe to
 *  call from every refresh(). The watch re-points when the day rolls over (dir path changes). */
export function syncRolloutWatch(store: Store, now: () => Date = () => new Date()): void {
  const hasPending = store.pendingIntents().some(i => i.cli === 'codex')
  if (!hasPending) { disarm(); return }
  const dir = rolloutDayDir(now())
  if (watcher && dir === watchedDir) return     // already watching the right dir
  disarm()
  watchedDir = dir
  const scanDir = () => { try { for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) bindFromRollout(store, join(dir, f)) } catch {} }
  try {
    if (existsSync(dir)) {
      const w = watch(dir, (_e, file) => { if (file && file.toString().endsWith('.jsonl')) bindFromRollout(store, join(dir, file.toString())) })
      ;(w as { unref?: () => void }).unref?.()
      watcher = w
    }
  } catch { /* watch unsupported/failed → poll covers it */ }
  // Coarse poll fallback (also covers: dir didn't exist yet when we tried to watch; day rollover).
  poll = setInterval(() => { if (!store.pendingIntents().some(i => i.cli === 'codex')) { disarm(); return } syncRolloutWatch(store, now); scanDir() }, ROLLOUT_POLL_MS)
  ;(poll as { unref?: () => void }).unref?.()
}

function disarm(): void {
  try { watcher?.close() } catch {}
  if (poll) clearInterval(poll)
  watcher = null; poll = null; watchedDir = ''
}
```

- [ ] **Step 2: Write a unit test for the pure pieces**

```typescript
// test/rollout-watch.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { rolloutDayDir, bindFromRollout } from '../src/server/rollout-watch'

describe('rolloutDayDir', () => {
  it('builds <home>/sessions/YYYY/MM/DD from a UTC date', () => {
    expect(rolloutDayDir(new Date('2026-06-27T12:00:00Z'), '/H')).toBe(join('/H', 'sessions', '2026', '06', '27'))
  })
})

describe('bindFromRollout', () => {
  it('binds a pending codex intent from a matching rollout first line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-rollout-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: dir, projectId: 'P', todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
      const path = join(dir, 'rollout-x.jsonl')
      writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { session_id: 'sid-1', cwd: dir, timestamp: new Date(1005_000).toISOString() } }) + '\n')
      expect(bindFromRollout(s, path)).toBe(true)
      expect(s.todoKeyForSession('sid-1')).toBe('task-A')
      expect(s.pendingIntents()).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not bind when the rollout cwd matches no pending intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-rollout-'))
    try {
      const s = openStore(':memory:')
      s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/other', projectId: null, todoKey: null, sessionId: null, createdAt: 1000, bound: false })
      const path = join(dir, 'rollout-y.jsonl')
      writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { session_id: 'sid', cwd: dir, timestamp: new Date(1005_000).toISOString() } }) + '\n')
      expect(bindFromRollout(s, path)).toBe(false)
      expect(s.pendingIntents().length).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 3: Run test to verify it fails then passes**

Run: `npx vitest run test/rollout-watch.test.ts`
Expected first: FAIL (module missing) → after Step 1 file exists: PASS (3 tests).

- [ ] **Step 4: Wire arm/disarm into `refresh()`**

In `src/server/store-singleton.ts`, add the import:

```typescript
import { syncRolloutWatch } from './rollout-watch'
```

At the end of `refresh()` (after the reconcile block, before `return cache`), add:

```typescript
  // Channel B: arm/disarm the rollout-dir watch based on whether any codex launch is still unbound.
  syncRolloutWatch(store)
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/server/rollout-watch.ts test/rollout-watch.test.ts src/server/store-singleton.ts
git commit -m "feat(launch): watch codex rollout dir for session_meta, armed only while pending (channel B)"
```

---

## Task 8: P2 — sweep dangling claude/coco edges

A `bound=1` launch whose pty is dead AND whose session never wrote a jsonl (absent from cache) AND is older than a grace period is an orphan — drop the intent and its dangling edge.

**Files:**
- Create: `src/server/orphan-sweep.ts`
- Test: `test/orphan-sweep.test.ts`
- Modify: `src/server/store-singleton.ts` (call from `refresh()`)

- [ ] **Step 1: Write the failing test**

```typescript
// test/orphan-sweep.test.ts
import { describe, it, expect } from 'vitest'
import { selectOrphanLaunches } from '../src/server/orphan-sweep'

const base = { id: 'i', sessionId: 's', createdAt: 1000 }
const opts = (over = {}) => ({ nowSec: 2000, graceSec: 300, hasLivePty: () => false, sessionExists: () => false, ...over })

describe('selectOrphanLaunches', () => {
  it('selects a bound launch with dead pty, no jsonl, older than grace', () => {
    expect(selectOrphanLaunches([base], opts())).toEqual(['i'])
  })
  it('keeps it if the pty is still alive', () => {
    expect(selectOrphanLaunches([base], opts({ hasLivePty: () => true }))).toEqual([])
  })
  it('keeps it if the session exists on disk', () => {
    expect(selectOrphanLaunches([base], opts({ sessionExists: () => true }))).toEqual([])
  })
  it('keeps it inside the grace window (still booting)', () => {
    expect(selectOrphanLaunches([base], opts({ nowSec: 1100 }))).toEqual([])
  })
  it('skips intents with no sessionId (codex pre-bind)', () => {
    expect(selectOrphanLaunches([{ id: 'i', sessionId: null, createdAt: 1000 }], opts())).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orphan-sweep.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/orphan-sweep.ts

export interface BoundLaunchLite { id: string; sessionId: string | null; createdAt: number }

/**
 * Ids of bound launches that are dangling: a session id was eagerly edged at launch (claude/coco) but
 * the session never materialized — its pty is dead, no jsonl exists for it, and it is older than the
 * boot grace period (so we don't sweep a slow-but-real launch mid-boot). Pure; the caller drops the
 * intent + its edge.
 */
export function selectOrphanLaunches(
  bound: BoundLaunchLite[],
  opts: { nowSec: number; graceSec: number; hasLivePty: (sessionId: string) => boolean; sessionExists: (sessionId: string) => boolean },
): string[] {
  return bound
    .filter(b => b.sessionId !== null)
    .filter(b => opts.nowSec - b.createdAt > opts.graceSec)
    .filter(b => !opts.hasLivePty(b.sessionId!))
    .filter(b => !opts.sessionExists(b.sessionId!))
    .map(b => b.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orphan-sweep.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into `refresh()`**

In `src/server/store-singleton.ts`, add imports:

```typescript
import { selectOrphanLaunches } from './orphan-sweep'
import { hasLivePty } from './pty-registry'
```

In `refresh()`, after `syncRolloutWatch(store)` and before `return cache`, add:

```typescript
  // P2: sweep dangling claude/coco edges whose eagerly-bound session never materialized. 10-min grace
  // keeps a slow-but-real launch (cold start / trust dialog) safe; cache is the post-filter scan so a
  // surfaced session counts as "exists".
  const cacheIds = new Set(cache.map(s => s.sessionId))
  const bound = store.allLaunchIntents().filter(i => i.bound && i.sessionId)
    .map(i => ({ id: i.id, sessionId: i.sessionId, createdAt: i.createdAt }))
  const nowSec = Math.floor(Date.now() / 1000)
  for (const id of selectOrphanLaunches(bound, { nowSec, graceSec: 600, hasLivePty, sessionExists: (sid) => cacheIds.has(sid) })) {
    const intent = bound.find(b => b.id === id)
    if (intent?.sessionId) store.removeEdgesForSession(intent.sessionId)
    store.deleteLaunchIntent(id)
  }
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add src/server/orphan-sweep.ts test/orphan-sweep.test.ts src/server/store-singleton.ts
git commit -m "feat(launch): P2 sweep dangling claude/coco edges whose session never materialized"
```

---

## Task 9: Docs + live verification

- [ ] **Step 1: Update ARCHITECTURE.md**

In `docs/ARCHITECTURE.md`, under the "Launch / terminal" module map, add a bullet after the
`reconcile.ts` line:

```markdown
- `server/bind.ts` + `server/launch-callback*.ts` + `server/rollout-watch.ts` — codex binds the
  task↔session edge **at session start** via two channels: (A) the SessionStart hook drops codex's
  envelope (real `session_id`) to `$BERTH_HOME/launch-callbacks/<intentId>.json`, watched + bound by
  token; (B) fallback watch of the codex rollout dir's `session_meta` (Δ=90s window, armed only while
  a codex intent is unbound). The legacy 40s `watchCodexFirstTurn`/`reconcile` is now a last-ditch
  fallback. `server/orphan-sweep.ts` drops dangling claude/coco edges whose session never materialized.
```

And add a gotcha (#17):

```markdown
17. **codex task↔session bind is now eager, not reconcile-only.** Two channels write the edge at
    session start (hook-callback by token = exact; rollout `session_meta` watch = guaranteed fallback,
    Δ=90s). Don't reintroduce a dependency on the 40s window for correctness — it's a last-ditch
    fallback now. The hook envelope carries `session_id`+`cwd` (probe-verified, codex 0.142.0); the
    callback FILE NAME carries the launch token (= intent id). See the bind-reliability spec/plan.
```

- [ ] **Step 2: Commit docs**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): document codex eager-bind channels + gotcha #17"
```

- [ ] **Step 3: Live verification (manual, BERTH_LIVE-style — requires a real codex)**

Run the dev backend against a scratch BERTH_HOME and launch a codex session from a task, then assert
the edge exists almost immediately (not after 40s) and survives a restart:

```bash
# 1. Start a clean backend
mkdir -p /tmp/berth-bindcheck
PORT=7788 BERTH_HOME=/tmp/berth-bindcheck npm start &
# 2. In the SPA (or via API), create a task and launch a CODEX session from it.
# 3. Within ~2s, confirm the edge is on disk (NOT waiting for a turn / 40s):
sqlite3 /tmp/berth-bindcheck/berth.sqlite 'SELECT todo_key, session_id FROM edge;'
#    Expect a row mapping the task id → the codex session id.
# 4. Confirm a callback file was produced + cleaned:
ls /tmp/berth-bindcheck/launch-callbacks/   # expect empty (consumed) after binding
# 5. Kill the backend hard (simulate the crash), restart it, hit /api/todos:
kill -9 %1; PORT=7788 BERTH_HOME=/tmp/berth-bindcheck npm start &
curl -s localhost:7788/api/todos | grep -o '"sessions":\[[^]]*\]'
#    Expect the codex session id still listed under the task.
rm -rf /tmp/berth-bindcheck
```

Expected: the edge row exists within ~2s of launch; the task still lists the session after a hard
restart. If the edge only appears after a turn runs, Channel A's env/hook wiring (Task 3) is the place
to debug — re-probe the hook stdin per spec "Still to verify".

---

## Self-Review notes (done while writing)

- **Spec coverage:** Channel A = Tasks 2-5; Channel B = Tasks 6-7; reconcile-as-fallback = unchanged
  (Task 1 keeps it working); claude/coco contrast P2 = Task 8; locked decisions (file-drop, Δ=90s,
  today-dir watch, 5s coarse poll) = Tasks 3/6/7. Probe "still to verify" items = Task 9 Step 3.
- **Type consistency:** `bindIntentToSession(store, intent, sessionId)`, `LaunchCallback{sessionId,cwd}`,
  `RolloutMeta{sessionId,cwd,startedAtSec}`, `PendingIntentLite{id,cwd,createdAt}`,
  `BoundLaunchLite{id,sessionId,createdAt}`, `matchRolloutToIntent(...windowSec=90)` are used
  identically across tasks.
- **Open mechanics carried into impl (not blockers):** confirm `BERTH_LAUNCH_TOKEN` reaches the hook
  (Task 9 live check); handle both `rename`/`change` fs.watch events (watchers process the named file
  regardless of event kind).
```
