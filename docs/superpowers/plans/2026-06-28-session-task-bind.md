# `berth session` (bind/unbind/list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `berth session` CLI command group so an agent can bind an existing session (running or finished) to a task — either its own current session (self-bind) or an arbitrary session by id.

**Architecture:** Thin CLI over the existing `POST /api/edge` (bind/unbind) and `GET /api/sessions` (list) endpoints — no new server endpoints, no DB schema change. Self-bind resolves "my session" from a newly-injected `BERTH_SESSION_ID` env var (claude/coco), falling back to a cwd+recency match against `/api/sessions` (codex, before reconcile).

**Tech Stack:** TypeScript, Node, Express (existing), vitest. CLI lives in `src/cli.ts` + `src/cli-data.ts`; PTY env injection in `src/pty/agent-env.ts` + `src/pty/launch.ts`.

---

## File Structure

- `src/pty/agent-env.ts` — **modify**: `agentSpawnEnv()` gains an optional `sessionId` → injects `BERTH_SESSION_ID`. (Pure, unit-tested.)
- `src/pty/launch.ts` — **modify**: `spawnEnv()` takes an optional `sessionId` and forwards it; call sites pass the known logical session id.
- `src/cli-data.ts` — **modify**: add `SessionLite` type, `selectCurrentSession()` (pure), `getSessions()`, `formatSessionLine()`, and `runSessionCli()`.
- `src/cli.ts` — **modify**: dispatch `session` subcommand; extend top-level `HELP`.
- `test/agent-env.test.ts` — **create**: BERTH_SESSION_ID injection.
- `test/cli-session.test.ts` — **create**: pure helpers + no-I/O throw paths.
- `skills/` bundled skill doc + CLI help — **modify**: document the new command for agents.

---

## Task 1: Inject `BERTH_SESSION_ID` into the agent PTY env

**Files:**
- Modify: `src/pty/agent-env.ts:14-22`
- Modify: `src/pty/launch.ts:21-27` (`spawnEnv`) and its call sites (`launchFresh`, `resumeSession`, `launchFreshStream`, `resumeSessionStream`, `spawnPerTurn`)
- Test: `test/agent-env.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/agent-env.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { agentSpawnEnv } from '../src/pty/agent-env'

describe('agentSpawnEnv', () => {
  it('injects BERTH_SESSION_ID when a sessionId is given', () => {
    const env = agentSpawnEnv({}, null, 'sid-123')
    expect(env.BERTH_SESSION_ID).toBe('sid-123')
  })
  it('omits BERTH_SESSION_ID when no sessionId is given', () => {
    expect(agentSpawnEnv({}, null).BERTH_SESSION_ID).toBeUndefined()
    expect(agentSpawnEnv({}, null, '').BERTH_SESSION_ID).toBeUndefined()
  })
  it('still advertises the server address alongside the session id', () => {
    const env = agentSpawnEnv({}, { port: 7777, host: '127.0.0.1', binDir: '/bin' }, 'sid-9')
    expect(env.BERTH_PORT).toBe('7777')
    expect(env.BERTH_SESSION_ID).toBe('sid-9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-env.test.ts`
Expected: FAIL — `agentSpawnEnv` currently takes only 2 args; `BERTH_SESSION_ID` is undefined.

- [ ] **Step 3: Add the optional `sessionId` param**

In `src/pty/agent-env.ts`, replace the function (lines 14-22) with:

```typescript
export function agentSpawnEnv(baseEnv: NodeJS.ProcessEnv, addr: AgentAddr | null, sessionId?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  if (addr) {
    env.PATH = addr.binDir + delimiter + (env.PATH ?? '')
    env.BERTH_PORT = String(addr.port)
    env.BERTH_HOST = addr.host
  }
  // Self-bind anchor: lets the agent's `berth session bind` resolve its own session deterministically.
  // claude/coco get a pre-minted id at launch; codex mints late, so it stays unset and self-bind falls
  // back to a cwd match (see cli-data.selectCurrentSession).
  if (sessionId) env.BERTH_SESSION_ID = sessionId
  return env
}
```

- [ ] **Step 4: Forward the id from `spawnEnv` and its callers in `launch.ts`**

In `src/pty/launch.ts`, change `spawnEnv` (lines 21-27) to accept and forward the id:

```typescript
function spawnEnv(sessionId?: string): NodeJS.ProcessEnv {
  const addr = getLocalServerAddress()
  if (!addr) return agentSpawnEnv(process.env, null, sessionId)
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'berth.mjs')
  const binDir = ensureAgentBerthShim(cliEntry)
  return agentSpawnEnv(process.env, { port: addr.port, host: addr.host, binDir }, sessionId)
}
```

Then pass the known id at each call site:
- `resumeSession` (line 80): `env: spawnEnv(s.sessionId) as any,`
- `launchFreshStream` (line 186): `const env = spawnEnv(o.sessionId) as any`
- `resumeSessionStream` (line 199): `env: spawnEnv(s.sessionId) as any,`
- `spawnPerTurn` (line 230): `env: spawnEnv(o.sessionId) as any,`
- `launchFresh` (line 263): `const env = spawnEnv(o.sessionId) as any` (codex's `o.sessionId` is undefined here, so it correctly stays unset).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/agent-env.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/pty/agent-env.ts src/pty/launch.ts test/agent-env.test.ts
git commit -m "feat(pty): inject BERTH_SESSION_ID into agent env for self-bind"
```

---

## Task 2: `selectCurrentSession` — resolve "my session" (pure helper)

**Files:**
- Modify: `src/cli-data.ts` (add import + type + helper near the HTTP plumbing section)
- Test: `test/cli-session.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/cli-session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { selectCurrentSession, type SessionLite } from '../src/cli-data'

const S = (over: Partial<SessionLite>): SessionLite =>
  ({ sessionId: 's', cli: 'claude', cwd: '/work', updatedAt: 1, todoKey: null, activity: null, ...over })

// identity canon so the test never touches the filesystem
const id = (p: string) => p

describe('selectCurrentSession', () => {
  const sessions = [
    S({ sessionId: 'a', cwd: '/work', updatedAt: 10 }),
    S({ sessionId: 'b', cwd: '/work', updatedAt: 30 }),
    S({ sessionId: 'c', cwd: '/other', updatedAt: 99 }),
  ]
  it('trusts BERTH_SESSION_ID when present (not inferred)', () => {
    expect(selectCurrentSession(sessions, { berthSessionId: 'zzz', cwd: '/work', canon: id }))
      .toEqual({ sessionId: 'zzz', inferred: false })
  })
  it('falls back to the most-recent session in the same cwd (inferred)', () => {
    expect(selectCurrentSession(sessions, { cwd: '/work', canon: id }))
      .toEqual({ sessionId: 'b', inferred: true })
  })
  it('returns null when no session matches the cwd', () => {
    expect(selectCurrentSession(sessions, { cwd: '/nowhere', canon: id })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-session.test.ts`
Expected: FAIL — `selectCurrentSession` / `SessionLite` not exported.

- [ ] **Step 3: Add the import, type, and helper**

In `src/cli-data.ts`, add to the imports at the top (after line 5):

```typescript
import { canonicalPathKey } from './path-normalize'
```

Then add, just above the `// ── HTTP plumbing ──` comment (line 90):

```typescript
export interface SessionLite {
  sessionId: string; cli: string; cwd: string | null; updatedAt: number
  todoKey: string | null; activity?: string | null
}

/**
 * Resolve "my current session" for self-bind. Prefers the BERTH_SESSION_ID injected at PTY launch
 * (deterministic for claude/coco). Falls back to the most-recently-updated session whose cwd matches
 * the caller's cwd (same heuristic as server/reconcile.ts) — used for codex before reconcile binds it.
 * `canon` is injectable for tests; defaults to the symlink-resolving path key.
 */
export function selectCurrentSession(
  sessions: SessionLite[],
  opts: { berthSessionId?: string; cwd: string; canon?: (p: string) => string },
): { sessionId: string; inferred: boolean } | null {
  if (opts.berthSessionId) return { sessionId: opts.berthSessionId, inferred: false }
  const canon = opts.canon ?? canonicalPathKey
  const target = canon(opts.cwd)
  const matches = sessions.filter(s => s.cwd != null && canon(s.cwd) === target)
  if (!matches.length) return null
  const best = matches.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  return { sessionId: best.sessionId, inferred: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli-session.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cli-data.ts test/cli-session.test.ts
git commit -m "feat(cli): selectCurrentSession resolves self-bind via env then cwd"
```

---

## Task 3: `runSessionCli` scaffold + `bind` subcommand

**Files:**
- Modify: `src/cli-data.ts` (add `getSessions`, `resolveCurrentSession` I/O wrapper, `SESSION_HELP`, `runSessionCli`)
- Test: `test/cli-session.test.ts` (append a no-I/O throw test)

- [ ] **Step 1: Write the failing test**

Append to `test/cli-session.test.ts`:

```typescript
import { runSessionCli } from '../src/cli-data'

describe('runSessionCli arg validation (no I/O)', () => {
  it('bind with no task ref throws usage before any request', async () => {
    await expect(runSessionCli(['bind'])).rejects.toThrow(/用法|usage/i)
  })
  it('unknown subcommand throws', async () => {
    await expect(runSessionCli(['wat'])).rejects.toThrow(/未知子命令|session/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-session.test.ts`
Expected: FAIL — `runSessionCli` not exported.

- [ ] **Step 3: Add the sessions fetch helper + I/O resolver**

In `src/cli-data.ts`, add after the existing `getProjects`/`resolveProjectOne` block (after line 151):

```typescript
async function getSessions(base: string): Promise<SessionLite[]> {
  return (await json(base, '/api/sessions')) ?? []
}

/** I/O wrapper around selectCurrentSession: fetch sessions, resolve, throw a helpful error if unresolved. */
async function resolveCurrentSession(base: string): Promise<string> {
  const picked = selectCurrentSession(await getSessions(base), {
    berthSessionId: process.env.BERTH_SESSION_ID,
    cwd: process.cwd(),
  })
  if (!picked) {
    throw new Error(
      '无法确定当前会话（环境里没有 BERTH_SESSION_ID，也没有匹配当前目录的会话）。\n' +
      '请显式指定 <sessionId>，或用 `berth session list` 查看可用会话。',
    )
  }
  if (picked.inferred) console.error(`（按当前目录推断的会话：${picked.sessionId.slice(0, 8)}）`)
  return picked.sessionId
}
```

- [ ] **Step 4: Add the help text + runner with `bind`**

In `src/cli-data.ts`, add after the `runProjectCli` function (end of file):

```typescript
const SESSION_HELP = `berth session — bind an existing session (running or finished) to a task

  berth session bind [<sessionId>] <id|title> [--project P]   Bind a session to a task (re-binds if already bound)
  berth session unbind [<sessionId>]                          Clear a session's task binding
  berth session list [--task <id|title>] [--json]             List sessions and their bound task

  <sessionId> omitted → the current session (from $BERTH_SESSION_ID, else matched by cwd).
  --port N / --host H   Reach a server not on 127.0.0.1:7777 (or $PORT)`

export async function runSessionCli(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const { flags, pos } = parseFlags(argv[0] === sub ? argv.slice(1) : argv)
  const base = baseUrl(flags)

  if (sub === 'help' || flags.help) { console.log(SESSION_HELP); return }

  switch (sub) {
    case 'bind': {
      // 2+ positionals → explicit "<sessionId> <task...>"; 1 → "<task...>" against the current session.
      const explicit = pos.length >= 2
      const taskRef = (explicit ? pos.slice(1) : pos).join(' ').trim()
      if (!taskRef) throw new Error('用法：berth session bind [<sessionId>] <id|title> [--project P]')
      const sessionId = explicit ? pos[0] : await resolveCurrentSession(base)
      const t = await resolveOne(base, taskRef)
      const projectId = flags.project ? (await resolveProjectOne(base, String(flags.project))).id : undefined
      await post(base, '/api/edge', { sessionId, todoKey: t.id, projectId })
      console.log(`✓ 已绑定会话 ${sessionId.slice(0, 8)} → ${t.title}`)
      return
    }
    default:
      throw new Error(`未知子命令：session ${sub}\n\n${SESSION_HELP}`)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli-session.test.ts`
Expected: PASS — the `bind`-no-task and unknown-subcommand throws fire before any network call.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cli-data.ts test/cli-session.test.ts
git commit -m "feat(cli): berth session bind (self or explicit session → task)"
```

---

## Task 4: `unbind` subcommand

**Files:**
- Modify: `src/cli-data.ts` (`runSessionCli` switch)

- [ ] **Step 1: Add the `unbind` case**

In `src/cli-data.ts`, add a case to the `runSessionCli` switch, directly after the `bind` case:

```typescript
    case 'unbind': {
      const sessionId = pos.length >= 1 ? pos[0] : await resolveCurrentSession(base)
      // No todoKey/projectId → server clears the session's edge but leaves its project attach intact.
      await post(base, '/api/edge', { sessionId })
      console.log(`✓ 已解绑会话 ${sessionId.slice(0, 8)}`)
      return
    }
```

- [ ] **Step 2: Run the suite to verify nothing regressed**

Run: `npx vitest run test/cli-session.test.ts`
Expected: PASS (unknown-subcommand test still passes; `unbind` adds no new throw path).

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cli-data.ts
git commit -m "feat(cli): berth session unbind clears a session's task edge"
```

---

## Task 5: `list` subcommand

**Files:**
- Modify: `src/cli-data.ts` (add `formatSessionLine`, `formatSessionTable`, and the `list` case)
- Test: `test/cli-session.test.ts` (append a formatting test)

- [ ] **Step 1: Write the failing test**

Append to `test/cli-session.test.ts`:

```typescript
import { formatSessionLine } from '../src/cli-data'

describe('formatSessionLine', () => {
  it('renders cli, activity, bound task title, cwd and short id', () => {
    const line = formatSessionLine(
      S({ sessionId: 'abcdef12-9999', cli: 'codex', cwd: '/repo', activity: 'running', todoKey: 'task-1' }),
      new Map([['task-1', '修复登录']]),
    )
    expect(line).toContain('codex')
    expect(line).toContain('running')
    expect(line).toContain('修复登录')
    expect(line).toContain('/repo')
    expect(line).toContain('[abcdef12]')
  })
  it('shows a dash for an unbound session', () => {
    const line = formatSessionLine(S({ sessionId: 'x', todoKey: null }), new Map())
    expect(line).toContain('-')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-session.test.ts`
Expected: FAIL — `formatSessionLine` not exported.

- [ ] **Step 3: Add the formatters**

In `src/cli-data.ts`, add just above the `// ── HTTP plumbing ──` comment (near `SessionLite`):

```typescript
export function formatSessionLine(s: SessionLite, taskTitles: Map<string, string>): string {
  const task = s.todoKey ? (taskTitles.get(s.todoKey) ?? s.todoKey.slice(0, 8)) : '-'
  return `${padEndW(s.cli, 6)} ${padEndW(s.activity || '-', 8)} ${padEndW(task, 20)} ${padEndW(s.cwd || '-', 28)} [${s.sessionId.slice(0, 8)}]`
}

function formatSessionTable(sessions: SessionLite[], taskTitles: Map<string, string>): string {
  if (!sessions.length) return '（没有会话）'
  return sessions.map(s => formatSessionLine(s, taskTitles)).join('\n')
}
```

- [ ] **Step 4: Add the `list` case**

In `src/cli-data.ts`, add a case to the `runSessionCli` switch, after the `unbind` case:

```typescript
    case 'list': {
      let sessions = await getSessions(base)
      if (flags.task) {
        const t = await resolveOne(base, String(flags.task))
        sessions = sessions.filter(s => s.todoKey === t.id)
      }
      if (flags.json) { console.log(JSON.stringify(sessions, null, 2)); return }
      const titles = new Map((await getTasks(base)).map(t => [t.id, t.title]))
      console.log(formatSessionTable(sessions, titles))
      return
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli-session.test.ts`
Expected: PASS (formatting tests green).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cli-data.ts test/cli-session.test.ts
git commit -m "feat(cli): berth session list shows sessions and their bound task"
```

---

## Task 6: Wire dispatch + top-level help in `cli.ts`

**Files:**
- Modify: `src/cli.ts:124-131` (dispatch) and `src/cli.ts:40-56` (HELP)
- Test: `test/cli-session.test.ts` already covers the runner; this task wires the entrypoint.

- [ ] **Step 1: Add `session` to the data-command dispatch**

In `src/cli.ts`, replace the data-command block (lines 124-131) with:

```typescript
  if (argv[0] === 'task' || argv[0] === 'project' || argv[0] === 'session') {
    const { runTaskCli, runProjectCli, runSessionCli } = await import('./cli-data')
    try {
      if (argv[0] === 'task') await runTaskCli(argv.slice(1))
      else if (argv[0] === 'project') await runProjectCli(argv.slice(1))
      else await runSessionCli(argv.slice(1))
    } catch (e: any) { console.error(`berth: ${e?.message ?? e}`); process.exit(1) }
    return
  }
```

- [ ] **Step 2: Document it in the top-level HELP**

In `src/cli.ts`, in the `HELP` template (after the `berth project ...` line, line 45), add:

```typescript
  berth session ...       Bind an existing session to a task (bind/unbind/list) — needs a running server
```

- [ ] **Step 3: Verify dispatch + help**

Run: `node bin/berth.mjs session help`
Expected: prints the `berth session — bind an existing session …` help block.

Run: `node bin/berth.mjs --help`
Expected: the help now lists `berth session ...`.

- [ ] **Step 4: Typecheck + run full suite + commit**

```bash
npx tsc --noEmit
npm test
git add src/cli.ts
git commit -m "feat(cli): dispatch berth session and document it in help"
```

---

## Task 7: Document the capability for agents (skill + README)

**Files:**
- Modify: the bundled Berth skill doc (find it: `git ls-files skills | grep -i SKILL.md` — likely `skills/berth/SKILL.md`)
- Modify: `README.md` if it enumerates `berth task`/`berth project` commands

- [ ] **Step 1: Find where the agent-facing command list lives**

Run: `git grep -n "berth task" -- skills README.md docs | grep -iv plans`
Expected: locate the skill/readme section that lists agent commands.

- [ ] **Step 2: Add a `berth session` entry**

In the bundled skill doc, alongside the `berth task`/`berth project` descriptions, add (match the file's existing language/format):

```markdown
- `berth session bind [<sessionId>] <id|title>` — associate an existing session (running or finished) with a task. Omit `<sessionId>` to bind the *current* session. `berth session unbind [<sessionId>]` clears it; `berth session list` shows sessions and their task.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document berth session bind/unbind/list for agents"
```

---

## Task 8 (optional): Live round-trip test

**Files:**
- Test: `test/cli-session.live.test.ts` (create) — gated behind `BERTH_LIVE=1`

- [ ] **Step 1: Write the live test**

Create `test/cli-session.live.test.ts` (mirror an existing `*.live.test.ts` for server setup/teardown):

```typescript
import { describe, it, expect } from 'vitest'

const LIVE = process.env.BERTH_LIVE === '1'
const d = LIVE ? describe : describe.skip

d('berth session bind/unbind round-trip', () => {
  it('binds a session to a task, then unbinds it', async () => {
    // 1. start a server (or reuse start() helper used by other live tests)
    // 2. POST /api/todos to create a task; capture its id
    // 3. POST /api/edge { sessionId: 'fake-sid', todoKey: <taskId> }
    // 4. GET /api/sessions OR GET /api/todos and assert the edge exists for 'fake-sid'
    // 5. POST /api/edge { sessionId: 'fake-sid' } (unbind)
    // 6. assert the edge is gone
    expect(true).toBe(true) // replace with the assertions above using the repo's live-test harness
  })
})
```

- [ ] **Step 2: Run it**

Run: `BERTH_LIVE=1 npx vitest run test/cli-session.live.test.ts`
Expected: PASS (binds then unbinds against a real server).

- [ ] **Step 3: Commit**

```bash
git add test/cli-session.live.test.ts
git commit -m "test: live round-trip for berth session bind/unbind"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — green
- [ ] Manual: in a Berth-launched claude session, run `berth session bind <task-title>` and confirm the task shows the session in the UI; `berth session list` shows the binding; `berth session unbind` removes it.

---

## Notes / decisions baked in

- **No new endpoints / no schema change** — reuses `POST /api/edge` and `GET /api/sessions`.
- **Re-bind semantics** — `bind` moves a session (the endpoint clears prior edges first); it never errors on an already-bound session (per approved design).
- **`unbind` preserves project attach** — only the task edge is cleared (the endpoint only touches `attach` when `projectId` is provided).
- **codex self-bind** — `BERTH_SESSION_ID` is unset for codex at launch; self-bind falls back to the cwd+recency match, matching `reconcile.ts`.
- **Task ref resolution reused** — `bind`/`list --task` accept id or title via the existing `resolveOne`, so agents don't pre-resolve.
