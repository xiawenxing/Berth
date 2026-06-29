# Berth single shared server + task-data live sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app, the `berth` CLI, and any browser tab share ONE backend server per `~/.berth` store, make the `berth-tasks` skill work on an app-only install with no second `start`, and push backend task-data changes to the frontend so the board updates without a manual reload.

**Architecture:** First-starter hosts one server on the canonical port (default 7777, `$PORT` override); everyone else connects; `berth start` is idempotent-reuse. Berth-spawned agents get a session-scoped `berth` shim on `PATH` plus `BERTH_PORT`/`BERTH_HOST`, so the skill auto-connects. Task mutations broadcast a `{t:'data'}` frame on the existing `/status` WS (with a `PRAGMA data_version` poll as a cross-process net); the frontend refetches on it.

**Tech Stack:** Node + TypeScript, Express, `ws`, better-sqlite3, node-pty, Electron, Vite/React, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-berth-single-server-live-sync-design.md`

### Preconditions / branch base

- This work shares the five `launch.ts` spawn sites with the clipboard `withUtf8Locale` fix on
  `release/clipboard-mac-roman-flavor`. **Rebase this branch onto that one before starting** (or merge it
  first), so the new `agentSpawnEnv()` helper composes `withUtf8Locale` in one place instead of a second
  env-injection refactor. If that branch isn't available, implement `agentSpawnEnv()` without the
  `withUtf8Locale` call and fold it in at merge.
- Run tests with Node 20: `export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"` then
  `node_modules/.bin/vitest run <file>` and `node_modules/.bin/tsc --noEmit`.

### File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/server-discovery.ts` | Port-file (`~/.berth/server.json`) read/write/remove + `pidAlive()`. Shared by server (write) + CLI (read). | New |
| `src/server/server-address.ts` | In-process record of the running server's `{port,host}` for `launch.ts` injection. | New |
| `src/server/agent-shim.ts` | Ensure a session-scoped `berth` launcher in `<berthHome>/bin`; return the dir. | New |
| `src/pty/agent-env.ts` | `agentSpawnEnv(baseEnv, addr)` — inject shim dir on `PATH` + `BERTH_PORT/HOST` (+ `withUtf8Locale`). | New |
| `src/server/api.ts` | `GET /api/health`; call `broadcastDataChanged()` from task-mutation endpoints. | Modify |
| `src/server/index.ts` | On `listen`: record address + write server.json + resolve CLI entry/shim; remove server.json on shutdown; start `data_version` poll. | Modify |
| `src/server/status-ws.ts` | `broadcastDataChanged()` + `{t:'data'}` frame. | Modify |
| `src/db/store.ts` | `dataVersion()` method (`PRAGMA data_version`). | Modify |
| `src/pty/launch.ts` | Use `agentSpawnEnv()` at the 5 spawn sites. | Modify |
| `src/cli-data.ts` | `baseUrl()` resolution order incl. `$BERTH_PORT` + server.json. | Modify |
| `src/cli.ts` | `berth start` idempotency (probe `/api/health`, reuse). | Modify |
| `electron/main.cjs` | Reuse-or-host on canonical port. | Modify |
| `web/src/lib/live.tsx` | On `{t:'data'}` frame → trigger data reload (debounced). | Modify |

---

## Phase A — single shared server + connectivity

### Task A1: `GET /api/health` endpoint

**Files:**
- Modify: `src/server/api.ts`
- Test: `test/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/health.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/server/store-singleton', () => ({
  getStore: () => ({ }), getCache: () => [], refresh: () => {}, initData: () => {},
}))
import request from 'supertest'                 // already a dev dep used by other api tests; if absent, use fetch against a listen()
import { api } from '../src/server/api'
import express from 'express'

describe('GET /api/health', () => {
  it('identifies a Berth server with version + berthHome + pid', async () => {
    const app = express(); app.use('/api', api)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.berth).toBe(true)
    expect(typeof res.body.pid).toBe('number')
    expect(typeof res.body.berthHome).toBe('string')
  })
})
```

If `supertest` isn't available, start the app with `createApp().listen(0)` and `fetch` the assigned port (see `test/api.test.ts` for the listen pattern); assert the same fields.

- [ ] **Step 2: Run it, expect FAIL** (`404` / route missing).
  Run: `node_modules/.bin/vitest run test/health.test.ts`

- [ ] **Step 3: Implement** — add near the top of the routes in `src/server/api.ts`:

```ts
import { berthHome } from '../paths'
// ...
api.get('/health', (_req, res) => {
  res.json({ berth: true, version: process.env.npm_package_version ?? null, berthHome: berthHome(), pid: process.pid })
})
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): add GET /api/health identity probe"`

---

### Task A2: server-discovery (port file)

**Files:**
- Create: `src/server-discovery.ts`
- Test: `test/server-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/server-discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeServerFile, readServerFile, removeServerFile, serverFilePath } from '../src/server-discovery'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-disc-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('server-discovery', () => {
  it('writes then reads back the address under BERTH_HOME', () => {
    writeServerFile({ port: 7777, host: '127.0.0.1' })
    expect(existsSync(serverFilePath())).toBe(true)
    const r = readServerFile()!
    expect(r.port).toBe(7777); expect(r.host).toBe('127.0.0.1'); expect(r.pid).toBe(process.pid)
  })
  it('returns null when the recorded pid is dead', () => {
    writeServerFile({ port: 7777, host: '127.0.0.1', pid: 2147483646 }) // a pid that won't exist
    expect(readServerFile()).toBeNull()
  })
  it('returns null when no file exists', () => { expect(readServerFile()).toBeNull() })
  it('removeServerFile is idempotent', () => { removeServerFile(); writeServerFile({ port: 1, host: 'h' }); removeServerFile(); expect(existsSync(serverFilePath())).toBe(false) })
})
```

- [ ] **Step 2: Run it, expect FAIL** (module not found).

- [ ] **Step 3: Implement `src/server-discovery.ts`:**

```ts
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { berthHome } from './paths'

export interface ServerAddress { port: number; host: string; pid?: number; startedAt?: number; version?: string }

export function serverFilePath(): string { return join(berthHome(), 'server.json') }

/** True if a process with this pid is alive (signal 0 probes without killing). */
function pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (e: any) { return e?.code === 'EPERM' } }

export function writeServerFile(addr: ServerAddress): void {
  const rec = { ...addr, pid: addr.pid ?? process.pid, startedAt: addr.startedAt ?? Date.now() }
  const tmp = serverFilePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(rec))
  // atomic-ish: write tmp then rename
  require('node:fs').renameSync(tmp, serverFilePath())
}

/** Read the recorded address, or null if missing/corrupt/stale (dead pid). */
export function readServerFile(): ServerAddress | null {
  const p = serverFilePath()
  if (!existsSync(p)) return null
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8')) as ServerAddress
    if (rec.pid != null && !pidAlive(rec.pid)) return null
    return rec
  } catch { return null }
}

export function removeServerFile(): void { try { rmSync(serverFilePath(), { force: true }) } catch {} }
```

Note: replace the inline `require('node:fs').renameSync` with a top `import { renameSync } from 'node:fs'`.

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: server-discovery port file (write/read/remove + stale-pid)"`

---

### Task A3: `dataVersion()` on the store

**Files:**
- Modify: `src/db/store.ts` (the object returned by `openStore`, around line 121)
- Test: `test/store-data-version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/store-data-version.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'

describe('store.dataVersion', () => {
  it('returns a number and changes after an external connection writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-dv-'))
    const path = join(dir, 'berth.sqlite')
    const a = openStore(path)
    const v0 = a.dataVersion()
    expect(typeof v0).toBe('number')
    const b = openStore(path)                                   // a SECOND connection (≈ another process)
    b.addEdge('todo-x', 'sess-y')                               // any committed write
    expect(a.dataVersion()).not.toBe(v0)                        // a sees b's commit via PRAGMA data_version
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (`dataVersion is not a function`).

- [ ] **Step 3: Implement** — in `src/db/store.ts`, inside the object literal returned by `openStore` (the `return { … }` at ~line 121), add:

```ts
    /** SQLite's data_version — bumps when ANOTHER connection/process commits. Same-connection writes do NOT bump it. */
    dataVersion(): number { return db.pragma('data_version', { simple: true }) as number },
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(store): expose dataVersion() for cross-process change detection"`

---

### Task A4: in-process server-address record

**Files:**
- Create: `src/server/server-address.ts`
- Test: `test/server-address.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/server-address.test.ts
import { describe, it, expect } from 'vitest'
import { setLocalServerAddress, getLocalServerAddress } from '../src/server/server-address'

describe('server-address', () => {
  it('records and returns the running server address', () => {
    expect(getLocalServerAddress()).toBeNull()
    setLocalServerAddress(7777, '127.0.0.1')
    expect(getLocalServerAddress()).toEqual({ port: 7777, host: '127.0.0.1' })
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement `src/server/server-address.ts`:**

```ts
let current: { port: number; host: string } | null = null
export function setLocalServerAddress(port: number, host: string): void { current = { port, host } }
export function getLocalServerAddress(): { port: number; host: string } | null { return current }
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(server): in-process record of the running server address"`

---

### Task A5: `berth` shim for spawned agents

**Files:**
- Create: `src/server/agent-shim.ts`
- Test: `test/agent-shim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/agent-shim.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureAgentBerthShim } from '../src/server/agent-shim'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-shim-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('ensureAgentBerthShim', () => {
  it('writes an executable berth launcher and returns its dir', () => {
    const dir = ensureAgentBerthShim('/path/to/bin/berth.mjs')
    const shim = join(dir, 'berth')
    expect(dir).toBe(join(home, 'bin'))
    expect(statSync(shim).mode & 0o111).not.toBe(0)              // executable bit set
    const body = readFileSync(shim, 'utf8')
    expect(body).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(body).toContain('/path/to/bin/berth.mjs')
  })
  it('is idempotent (no rewrite when content matches)', () => {
    const d1 = ensureAgentBerthShim('/x/berth.mjs'); const d2 = ensureAgentBerthShim('/x/berth.mjs')
    expect(d1).toBe(d2)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement `src/server/agent-shim.ts`:**

```ts
import { chmodSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { berthHome } from '../paths'

/**
 * Ensure a `berth` launcher in <berthHome>/bin and return that dir (to prepend to a spawned agent's
 * PATH). The launcher re-invokes the CURRENT runtime as Node against the CLI entry, so it works whether
 * Berth runs as the packaged Electron app (ELECTRON_RUN_AS_NODE) or plain node (the var is ignored there).
 */
export function ensureAgentBerthShim(cliEntry: string): string {
  const binDir = join(berthHome(), 'bin')
  mkdirSync(binDir, { recursive: true })
  const shimPath = join(binDir, 'berth')
  const body =
    '#!/bin/sh\n' +
    '# Auto-generated by Berth — launches the bundled CLI against the running server.\n' +
    `ELECTRON_RUN_AS_NODE=1 exec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliEntry)} "$@"\n`
  if (!existsSync(shimPath) || readFileSync(shimPath, 'utf8') !== body) {
    writeFileSync(shimPath, body); chmodSync(shimPath, 0o755)
  }
  return binDir
}
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(server): session-scoped berth shim for spawned agents"`

> **Packaging note (verify, like the clipboard fix):** `cliEntry` must resolve to `bin/berth.mjs` inside
> the packaged app's resources (asarUnpack already unpacks `dist/**`; ensure `bin/**` is shipped too —
> add `- bin/**` to `files:` in `electron-builder.yml` if missing). Verify post-build by running the shim
> with `--version` from a packaged `.app`.

---

### Task A6: `agentSpawnEnv()` helper

**Files:**
- Create: `src/pty/agent-env.ts`
- Test: `test/agent-env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/agent-env.test.ts
import { describe, it, expect } from 'vitest'
import { agentSpawnEnv } from '../src/pty/agent-env'

describe('agentSpawnEnv', () => {
  it('prepends the shim dir to PATH and sets BERTH_PORT/BERTH_HOST', () => {
    const out = agentSpawnEnv({ PATH: '/usr/bin' }, { port: 7777, host: '127.0.0.1', binDir: '/home/.berth/bin' })
    expect(out.PATH!.startsWith('/home/.berth/bin:')).toBe(true)
    expect(out.PATH).toContain('/usr/bin')
    expect(out.BERTH_PORT).toBe('7777')
    expect(out.BERTH_HOST).toBe('127.0.0.1')
  })
  it('does not mutate the input', () => {
    const env = { PATH: '/usr/bin' }
    agentSpawnEnv(env, { port: 1, host: 'h', binDir: '/b' })
    expect(env.BERTH_PORT).toBeUndefined()
  })
  it('no-ops the address injection when addr is null (still returns a usable env)', () => {
    const out = agentSpawnEnv({ PATH: '/usr/bin' }, null)
    expect(out.PATH).toBe('/usr/bin'); expect(out.BERTH_PORT).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement `src/pty/agent-env.ts`:**

```ts
import { delimiter } from 'node:path'
// When rebased on release/clipboard-mac-roman-flavor, also: import { withUtf8Locale } from './locale'

export interface AgentAddr { port: number; host: string; binDir: string }

/**
 * Build the env for a Berth-spawned agent PTY: prepend the berth-shim dir to PATH and advertise the
 * server address via BERTH_PORT/BERTH_HOST so the agent's `berth task …` finds the CLI and connects to
 * the server that launched it. Returns a new object; never mutates input. `addr` null → address skipped.
 */
export function agentSpawnEnv(baseEnv: NodeJS.ProcessEnv, addr: AgentAddr | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }   // when rebased: withUtf8Locale({ ...baseEnv })
  if (addr) {
    env.PATH = addr.binDir + delimiter + (env.PATH ?? '')
    env.BERTH_PORT = String(addr.port)
    env.BERTH_HOST = addr.host
  }
  return env
}
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pty): agentSpawnEnv injects berth shim + BERTH_PORT/HOST"`

---

### Task A7: wire `start()` → record address, write server.json, build shim, data_version poll; remove file on shutdown

**Files:**
- Modify: `src/server/index.ts` (the `start()` function, around the `server.listen` at line 87)
- Test: `test/server-start-wiring.test.ts` (integration: listen on port 0, assert side effects)

- [ ] **Step 1: Write the failing test**

```ts
// test/server-start-wiring.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerFile } from '../src/server-discovery'
import { getLocalServerAddress } from '../src/server/server-address'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'berth-start-')); process.env.BERTH_HOME = home })
afterEach(() => { delete process.env.BERTH_HOME; rmSync(home, { recursive: true, force: true }) })

describe('start() wiring', () => {
  it('records the address and writes server.json on listen, removes it on close', async () => {
    const { start } = await import('../src/server/index')
    const { port, server } = await start(0, '127.0.0.1') as any
    expect(getLocalServerAddress()).toEqual({ port, host: '127.0.0.1' })
    expect(readServerFile()!.port).toBe(port)
    await new Promise<void>(r => server.close(() => r()))
    expect(readServerFile()).toBeNull()   // removed on graceful close
  })
})
```

(If `start()` doesn't currently return `server`, add it to its return — it already returns `{ port, hasWeb }`; extend to `{ port, hasWeb, server }`.)

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — in `src/server/index.ts`, inside the `server.listen(port, host, () => { … })` callback (line 87), after the actual port is known (`const actual = (server.address() as any).port`):

```ts
import { setLocalServerAddress } from './server-address'
import { writeServerFile, removeServerFile } from '../server-discovery'
import { ensureAgentBerthShim } from './agent-shim'
import { fileURLToPath } from 'node:url'
import { startDataVersionPoll } from './status-ws'   // added in Task B3; until then omit this line + call
// ...
const actual = (server.address() as any).port
setLocalServerAddress(actual, host)
writeServerFile({ port: actual, host, version: process.env.npm_package_version ?? undefined })
// resolve the CLI entry shipped beside the compiled server (dist/server/index.js → ../../bin/berth.mjs)
const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'berth.mjs')
ensureAgentBerthShim(cliEntry)
// remove the port file when the process exits or the server closes
const cleanup = () => removeServerFile()
server.on('close', cleanup)
process.once('exit', cleanup)
```

Extend the resolved value to include `server` so callers (and the test) can close it:

```ts
resolve({ port: actual, hasWeb, server })
```

- [ ] **Step 4: Run it, expect PASS.** Run `tsc --noEmit` too.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): record address + server.json + agent shim on listen"`

---

### Task A8: thread the recorded address into `launch.ts` spawns

**Files:**
- Modify: `src/pty/launch.ts` (the 5 spawn sites — `resumeSession`, `launchFreshStream`, `resumeSessionStream`, the per-turn stream spawn, and `launchFresh`)
- Test: `test/launch-env.test.ts`

- [ ] **Step 1: Write the failing test** (assert the env passed to the spawn carries `BERTH_PORT` + shim PATH)

```ts
// test/launch-env.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const spawnCalls: any[] = []
vi.mock('node-pty', () => ({ spawn: (_bin: string, _argv: string[], opts: any) => { spawnCalls.push(opts); return { onData(){}, onExit(){}, write(){}, kill(){}, pid: 1 } } }))
vi.mock('../src/pty/binaries', () => ({ resolveAgentBinary: () => '/bin/claude', codexHookTrustSupportOrWarm: () => true }))
vi.mock('../src/pty/trust', () => ({ ensureClaudeTrust: () => {}, ensureCodexTrust: () => {} }))
vi.mock('../src/server/server-address', () => ({ getLocalServerAddress: () => ({ port: 7777, host: '127.0.0.1' }) }))
vi.mock('../src/server/agent-shim', () => ({ ensureAgentBerthShim: () => '/home/.berth/bin' }))

beforeEach(() => { spawnCalls.length = 0 })

describe('launch env injection', () => {
  it('resumeSession PTY env carries BERTH_PORT + shim PATH', async () => {
    const { resumeSession } = await import('../src/pty/launch')
    resumeSession({ sessionId: 's', cwd: process.cwd(), resume: { cli: 'claude', id: 'i' } } as any)
    const env = spawnCalls[0].env
    expect(env.BERTH_PORT).toBe('7777')
    expect(String(env.PATH).startsWith('/home/.berth/bin:')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — in `src/pty/launch.ts`, add a small resolver and use it at every spawn site:

```ts
import { agentSpawnEnv } from './agent-env'
import { getLocalServerAddress } from '../server/server-address'
import { ensureAgentBerthShim } from '../server/agent-shim'
import { fileURLToPath } from 'node:url'

function spawnEnv(): NodeJS.ProcessEnv {
  const addr = getLocalServerAddress()
  if (!addr) return agentSpawnEnv(process.env, null)
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'berth.mjs')
  const binDir = ensureAgentBerthShim(cliEntry)
  return agentSpawnEnv(process.env, { port: addr.port, host: addr.host, binDir })
}
```

Replace each `env: process.env as any` / `env: { ...(process.env as any) }` with `env: spawnEnv() as any`.
For the two sites that then mutate env (the per-turn spawn adds `BERTH_CONTEXT_FILE`), keep:
`const env = spawnEnv() as any; … env.BERTH_CONTEXT_FILE = …`.

Add `import { dirname } from 'node:path'` if not present.

- [ ] **Step 4: Run it, expect PASS.** Run full `vitest run` to confirm no spawn-site regressions.
- [ ] **Step 5: Commit** — `git commit -am "feat(pty): inject server address + berth shim into all agent spawns"`

---

### Task A9: CLI `baseUrl()` resolution order

**Files:**
- Modify: `src/cli-data.ts` (`baseUrl`, lines 90-93)
- Test: `test/cli-baseurl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/cli-baseurl.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeServerFile } from '../src/server-discovery'
import { __resolveBaseUrl } from '../src/cli-data'   // export the resolver for testing

const ENV = ['BERTH_PORT','BERTH_HOST','PORT','HOST'] as const
let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(),'berth-url-')); process.env.BERTH_HOME = home; ENV.forEach(k => delete process.env[k]) })
afterEach(() => { delete process.env.BERTH_HOME; ENV.forEach(k => delete process.env[k]); rmSync(home,{recursive:true,force:true}) })

describe('baseUrl resolution order', () => {
  it('explicit --port wins over everything', () => {
    process.env.BERTH_PORT = '8000'
    expect(__resolveBaseUrl({ port: '9001' })).toBe('http://127.0.0.1:9001')
  })
  it('$BERTH_PORT beats $PORT', () => {
    process.env.BERTH_PORT = '8000'; process.env.PORT = '7000'
    expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:8000')
  })
  it('$PORT used when no BERTH_PORT', () => { process.env.PORT = '7000'; expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:7000') })
  it('falls back to server.json when no env', () => {
    writeServerFile({ port: 6543, host: '127.0.0.1' })
    expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:6543')
  })
  it('defaults to 7777', () => { expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:7777') })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — rewrite `baseUrl()` in `src/cli-data.ts` and export a testable resolver:

```ts
import { readServerFile } from './server-discovery'

export function __resolveBaseUrl(flags: Record<string, string | boolean>): string {
  const host = (flags.host as string) ?? process.env.BERTH_HOST ?? process.env.HOST ?? '127.0.0.1'
  const file = (!flags.port && !process.env.BERTH_PORT && !process.env.PORT) ? readServerFile() : null
  const port = (flags.port as string) ?? process.env.BERTH_PORT ?? process.env.PORT ?? (file ? String(file.port) : '7777')
  const h = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${h}:${port}`
}
function baseUrl(flags: Record<string, string | boolean>): string { return __resolveBaseUrl(flags) }
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(cli): baseUrl resolves BERTH_PORT → PORT → server.json → 7777"`

---

### Task A10: `berth start` idempotency

**Files:**
- Modify: `src/cli.ts` (`runCli`, around the `start(...)` call at line 141)
- Test: `test/cli-start-idempotent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/cli-start-idempotent.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const opened: string[] = []
const fetchMock = vi.fn()
beforeEach(() => { opened.length = 0; vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('berth start idempotency', () => {
  it('when a Berth server already answers /api/health, it reuses (no second start)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ berth: true }) })
    const startSpy = vi.fn()
    vi.doMock('../src/server/index', () => ({ start: startSpy }))
    const { runCli } = await import('../src/cli')
    await runCli(['start'], '0.0.0')
    expect(startSpy).not.toHaveBeenCalled()   // reused; never bound a second server
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — in `src/cli.ts runCli`, before `const { start } = await import('./server/index')`, add a probe:

```ts
async function berthHealth(host: string, port: number): Promise<boolean> {
  try { const r = await fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`)
        return r.ok && (await r.json())?.berth === true } catch { return false }
}
// inside runCli, after parsing args / before importing start:
const probeHost = args.host ?? process.env.HOST ?? '127.0.0.1'
const probePort = Number(args.port ?? process.env.PORT ?? 7777)
if (args.command === 'start' && await berthHealth(probeHost, probePort)) {
  const base = `http://${probeHost === '0.0.0.0' ? 'localhost' : probeHost}:${probePort}`
  console.log(`berth: 已在运行 ${base} — 打开前端`)
  if (args.open) openBrowser(`${base}/app/`)
  return
}
```

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(cli): berth start reuses an already-running server"`

---

### Task A11: Berth.app reuse-or-host on canonical port

**Files:**
- Modify: `electron/main.cjs`
- Test: manual (Electron main can't be unit-tested here) — verification procedure below.

- [ ] **Step 1: Implement** — change `bootServer()` / `app.whenReady` in `electron/main.cjs`:

```js
const CANON_PORT = Number(process.env.PORT || 7777)
const CANON_HOST = '127.0.0.1'

async function berthHealth(port) {
  try { const r = await fetch(`http://${CANON_HOST}:${port}/api/health`); return r.ok && (await r.json())?.berth === true } catch { return false }
}

async function resolveServer() {
  if (await berthHealth(CANON_PORT)) return CANON_PORT            // reuse a running Berth (CLI or prior app)
  try { const { start } = await import(path.join(__dirname, '..', 'dist', 'server', 'index.js'))
        const { port } = await start(CANON_PORT, CANON_HOST); return port }   // host on canonical port
  catch (e) {                                                     // canonical port taken by non-Berth → free port
    const { start } = await import(path.join(__dirname, '..', 'dist', 'server', 'index.js'))
    const { port } = await start(0, CANON_HOST); return port      // start() already writes ~/.berth/server.json
  }
}
// in app.whenReady: const port = await resolveServer(); createWindow(port)
```

- [ ] **Step 2: Verify (manual, like the clipboard fix).**
  - Build: `npm run build` then `npm run electron:release` (or a local unsigned build).
  - Scenario A (app-only): quit any `berth start`; `open Berth.app`; `curl 127.0.0.1:7777/api/health` → `{berth:true}`; in the app, run an agent and `berth task list` inside it → connects.
  - Scenario B (cli-first): `berth start` (7777 up) → `open Berth.app` → app window loads 7777; `lsof -iTCP:7777` shows ONE listener (the cli's), app didn't bind a second.
  - Scenario C (dev:clean): `PORT=7788 BERTH_HOME=/tmp/berth-clean npm start` stays separate from 7777.

- [ ] **Step 3: Commit** — `git commit -am "feat(app): reuse-or-host the shared server on the canonical port"`

---

## Phase B — backend → frontend live refresh

### Task B1: `broadcastDataChanged()` + `{t:'data'}` frame

**Files:**
- Modify: `src/server/status-ws.ts`
- Test: `test/status-ws-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/status-ws-data.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/server/pty-registry', () => ({ snapshotActivity: () => [], subscribeActivity: () => {} }))
vi.mock('../src/server/store-singleton', () => ({ getCache: () => [] }))
import { handleStatusConnection, broadcastDataChanged } from '../src/server/status-ws'

describe('broadcastDataChanged', () => {
  it('sends a {t:"data"} frame to connected clients', () => {
    const sent: string[] = []
    handleStatusConnection({ send: (s: string) => sent.push(s), on: () => {} } as any)
    sent.length = 0
    broadcastDataChanged()
    expect(JSON.parse(sent[0])).toEqual({ t: 'data' })
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — in `src/server/status-ws.ts`, export:

```ts
let dataTimer: ReturnType<typeof setTimeout> | null = null
/** Coalesced "task data changed — refetch" signal to every /status client (~200ms debounce). */
export function broadcastDataChanged(): void {
  if (dataTimer) return
  dataTimer = setTimeout(() => { dataTimer = null; broadcast(JSON.stringify({ t: 'data' })) }, 200)
}
```

For a deterministic test, either use `vi.useFakeTimers()` and advance 200ms, or expose the debounce window via an optional arg defaulting to 200 and pass `0` in the test. (Adjust the test accordingly.)

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(status-ws): broadcastDataChanged emits a debounced {t:data} frame"`

---

### Task B2: trigger broadcast from task-mutation endpoints

**Files:**
- Modify: `src/server/api.ts` (`POST /todos`, `PATCH /todos/:id`, `DELETE /todos/:id`, `POST /todos/:id/title`, `POST /edge`)
- Test: `test/api-broadcast.test.ts`

- [ ] **Step 1: Write the failing test** (spy on `broadcastDataChanged`, hit an endpoint, assert called)

```ts
// test/api-broadcast.test.ts  (follow test/api.test.ts mocking of store-singleton)
import { describe, it, expect, vi } from 'vitest'
const broadcast = vi.fn()
vi.mock('../src/server/status-ws', () => ({ broadcastDataChanged: broadcast, createStatusWss: () => ({}) }))
// … plus the store-singleton mock block from test/api.test.ts …
import request from 'supertest'; import express from 'express'; import { api } from '../src/server/api'

describe('task mutations broadcast', () => {
  it('POST /edge triggers broadcastDataChanged', async () => {
    const app = express(); app.use(express.json()); app.use('/api', api)
    await request(app).post('/api/edge').send({ sessionId: 's', todoKey: 't' })
    expect(broadcast).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — `import { broadcastDataChanged } from './status-ws'` in `api.ts`, and add `broadcastDataChanged()` right before each successful `res.json(...)` in the 5 endpoints listed.

- [ ] **Step 4: Run it, expect PASS.** Run full `vitest run`.
- [ ] **Step 5: Commit** — `git commit -am "feat(api): broadcast data-changed on task mutations"`

---

### Task B3: `data_version` cross-process poll

**Files:**
- Modify: `src/server/status-ws.ts` (add `startDataVersionPoll`) and call it from `src/server/index.ts start()`
- Test: `test/data-version-poll.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/data-version-poll.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/server/pty-registry', () => ({ snapshotActivity: () => [], subscribeActivity: () => {} }))
let version = 1
vi.mock('../src/server/store-singleton', () => ({ getCache: () => [], getStore: () => ({ dataVersion: () => version }) }))
import { handleStatusConnection, startDataVersionPoll } from '../src/server/status-ws'

describe('startDataVersionPoll', () => {
  it('broadcasts {t:data} when data_version changes', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    handleStatusConnection({ send: (s: string) => sent.push(s), on: () => {} } as any); sent.length = 0
    const stop = startDataVersionPoll(50, 0)   // (intervalMs, debounceMs=0 for the test)
    version = 2; await vi.advanceTimersByTimeAsync(60)
    expect(sent.some(s => JSON.parse(s).t === 'data')).toBe(true)
    stop(); vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** — in `status-ws.ts`:

```ts
import { getStore } from './store-singleton'
/** Poll PRAGMA data_version; broadcast when another connection/process committed. Returns a stop fn. */
export function startDataVersionPoll(intervalMs = 1500): () => void {
  let last = getStore().dataVersion()
  const iv = setInterval(() => {
    const v = getStore().dataVersion()
    if (v !== last) { last = v; broadcastDataChanged() }
  }, intervalMs)
  return () => clearInterval(iv)
}
```

Call `startDataVersionPoll()` once from `start()` in `index.ts` (the import stubbed in Task A7).

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(status-ws): data_version poll broadcasts cross-process task changes"`

---

### Task B4: frontend reload on `{t:'data'}`

**Files:**
- Modify: `web/src/lib/live.tsx` (the `/status` `ws.onmessage`, ~line 79); it must signal `data.tsx` to bump `nonce`.
- Test: `web/src/lib/live.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing test** — feed a `{t:'data'}` frame to the live handler and assert the reload callback fires (debounced).

```ts
// web/src/lib/live.test.tsx (add a case)
it('invokes the data-reload callback on a {t:"data"} frame', async () => {
  const reload = vi.fn()
  // mount the hook/consumer with reload injected (see how live.tsx exposes its onData hook), then:
  fakeWs.emit({ data: JSON.stringify({ t: 'data' }) })
  await vi.waitFor(() => expect(reload).toHaveBeenCalled())
})
```

- [ ] **Step 2: Run it, expect FAIL.**
  Run: `cd web && npm run test -- live`

- [ ] **Step 3: Implement** — in `web/src/lib/live.tsx`, in the `/status` `onmessage`, after JSON-parsing the frame, handle the new type and call a reload hook wired to `data.tsx`'s `reload()` (already exposed at `data.tsx:259`). Debounce ~200ms client-side:

```ts
const msg = JSON.parse(e.data)
if (msg.t === 'data') { scheduleReload(); return }   // scheduleReload = debounced () => dataReload()
```

Wire `dataReload` from `useData().reload`. (If `live.tsx` can't reach the data context directly, lift the `{t:'data'}` handling into the component that owns both — e.g. add an effect in `data.tsx` that reuses the same `/status` socket and bumps `nonce` on a data frame. Prefer reusing the one socket.)

- [ ] **Step 4: Run it, expect PASS.** Then `cd web && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): refetch task data on a {t:data} push frame"`

---

## Final verification

- [ ] `node_modules/.bin/tsc --noEmit` clean; `cd web && npm run typecheck` clean.
- [ ] `node_modules/.bin/vitest run` green (re-run the cold `binaries.test.ts` flake if it times out); `cd web && npm test` green.
- [ ] Manual end-to-end (Task A11 scenarios A/B/C) + create a task via CLI while the app window is open → it appears **without** a manual reload (the push working end-to-end).
- [ ] Update the `berth-tasks` skill doc if the "Berth 服务必须在运行" guidance changes (now: the app IS the server; the skill auto-connects in-session).

## Self-review notes

- **Spec coverage:** A.1 health→A1; A.2 canonical/first-host→A10,A11; A.3 server.json→A2,A7; A.4 env injection (CLI shim + BERTH_PORT)→A5,A6,A8; A.5 resolution order→A9; B.1 broadcast→B1; B.2 triggers→B2; B.3 data_version→A3,B3; B.4 frontend→B4. All covered.
- **Known soft spots to verify during execution (not placeholders):** the packaged-app `cliEntry`/`bin/**` shipping (A5 note) and the `live.tsx`↔`data.tsx` wiring (A single `/status` socket should drive both spinner and data-reload — prefer reusing it, B4).
