# CLI Availability Detection & Install Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect which CLI agents (claude/codex/coco) are actually usable on this machine, stop default-enabling unavailable or outdated ones, and guide the user to install/upgrade when none are usable.

**Architecture:** Backend-authoritative detection. A new `src/pty/availability.ts` computes a per-CLI `CliStatus` (installed + version/identity + `ok`), cached in-process and refreshed (a) once at startup and (b) on-demand when the user enables a CLI in Settings. `GET /api/settings` returns the cached availability alongside the stored agent config; `POST /api/settings` validates enables against a fresh detection. First-run seeding enables only `ok` CLIs. The React SPA (`web/`) renders status badges, gates the enable toggle, and shows an install/upgrade notice when nothing is usable.

**Tech Stack:** Node + TypeScript backend (`src/`), Vitest unit tests (`test/`), React + Vite + Tailwind SPA (`web/`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-26-cli-availability-detection-design.md`

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/data/agent-config.ts` | `CliReason`/`CliStatus` types, `MIN_CLI_VERSIONS`, seeding, relaxed validation | Modify |
| `src/pty/binaries.ts` | add `execVersion` probe helper (reuses existing exec pattern) | Modify |
| `src/pty/availability.ts` | `detectCli`/`detectAllClis`, semver helpers, in-process cache, `okCliSet`/`getCachedAvailability` | **Create** |
| `src/server/api.ts` | `availability` in GET /settings; new `GET /agents/:cli/status`; POST validates against fresh detect | Modify |
| `src/server/index.ts` | startup: detached detect + first-run seed | Modify |
| `web/src/lib/api.ts` | `CliStatus` type, `availability` on `AgentConfig`, `agentStatus()` client | Modify |
| `web/src/lib/data.tsx` | default `availability: []` | Modify |
| `web/src/lib/agent-install.ts` | per-CLI install/upgrade hint copy | **Create** |
| `web/src/components/AgentAvailabilityNotice.tsx` | reusable "install one of these" notice | **Create** |
| `web/src/pages/Settings.tsx` | status badges, gated enable toggle, on-enable fresh detect | Modify |
| `web/src/components/LaunchDialog.tsx` | swap bare warning for the notice when nothing usable | Modify |
| `test/availability.test.ts` | unit coverage for detection, seeding, validation | **Create** |

---

## Task 1: Status types, version floors, and semver helpers

**Files:**
- Modify: `src/data/agent-config.ts` (add types + floors near the top, after line 28)
- Create: `src/pty/availability.ts` (semver helpers only this task)
- Test: `test/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/availability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractSemver, semverGte } from '../src/pty/availability'

describe('semver helpers', () => {
  it('extracts x.y.z from real --version output', () => {
    expect(extractSemver('codex-cli 0.139.0')).toBe('0.139.0')
    expect(extractSemver('2.1.4 (Claude Code)')).toBe('2.1.4')
    expect(extractSemver('no version here')).toBeNull()
  })
  it('compares semver with >= semantics', () => {
    expect(semverGte('0.139.0', '0.40.0')).toBe(true)
    expect(semverGte('0.40.0', '0.40.0')).toBe(true)
    expect(semverGte('0.39.9', '0.40.0')).toBe(false)
    expect(semverGte('1.0.0', '0.40.0')).toBe(true)
    expect(semverGte('2.0.0', '10.0.0')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/availability.test.ts`
Expected: FAIL — cannot find module `../src/pty/availability`.

- [ ] **Step 3: Add the status types + floors to `agent-config.ts`**

Insert after line 28 (`export const DEFAULT_BERTH_MODEL = 'claude-haiku-4-5'`):

```ts
/** Why a CLI is (not) usable, surfaced to the UI for install/upgrade copy. */
export type CliReason = 'ok' | 'missing' | 'outdated' | 'unverified'

/** Live usability of one CLI on this machine (computed by src/pty/availability.ts). */
export interface CliStatus {
  cli: AgentCli
  installed: boolean         // binary resolved on disk/PATH
  binPath: string | null
  version: string | null     // parsed from --version (claude/codex); null for coco
  minVersion: string | null  // requirement (null for coco)
  ok: boolean                // installed && identity-ok && version>=min
  reason: CliReason
}

/** Minimum acceptable version per CLI. claude/codex only; coco is identity-gated (no floor).
 *  Conservative starting values — tune as real-world minimums become clear. */
export const MIN_CLI_VERSIONS: Partial<Record<AgentCli, string>> = {
  claude: '1.0.0',
  codex: '0.40.0',
}
```

- [ ] **Step 4: Create `src/pty/availability.ts` with the semver helpers**

```ts
import type { AgentCli } from '../types'
import { KNOWN_CLIS, MIN_CLI_VERSIONS, type CliStatus } from '../data/agent-config'
import { firstUsableCandidate, verifyCocoAsync, execVersion } from './binaries'

/** Pull the first `x.y.z` out of a `--version` blob (banners/suffixes vary by CLI). */
export function extractSemver(text: string): string | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

/** `a >= b` for dotted `x.y.z` strings. */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}
```

(This imports `execVersion` and others not yet defined — Task 2 adds them. The semver test only needs the two helpers, so it passes now; `tsc` is run at the end of Task 2.)

- [ ] **Step 5: Run the semver test to verify it passes**

Run: `npx vitest run test/availability.test.ts -t "semver helpers"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/data/agent-config.ts src/pty/availability.ts test/availability.test.ts
git commit -m "feat(availability): CliStatus types, version floors, semver helpers"
```

---

## Task 2: Per-CLI detection + cache

**Files:**
- Modify: `src/pty/binaries.ts` (add `execVersion`)
- Modify: `src/pty/availability.ts` (add detection + cache)
- Test: `test/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/availability.test.ts`:

```ts
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectCli } from '../src/pty/availability'

// A fake binary that prints `out` for ANY args (so it answers both --version and --help).
function fakeBin(name: string, out: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-avail-'))
  const bin = join(dir, name)
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('detectCli', () => {
  it('reports missing when no binary resolves (coco pinned to ~/.local/bin)', async () => {
    // In CI/dev without coco installed this resolves missing; assert the shape, not a specific reason
    const s = await detectCli('coco')
    expect(s.cli).toBe('coco')
    expect(['missing', 'ok', 'unverified']).toContain(s.reason)
    if (s.reason === 'missing') expect(s.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/availability.test.ts -t "detectCli"`
Expected: FAIL — `detectCli` not exported / `execVersion` missing.

- [ ] **Step 3: Add `execVersion` to `binaries.ts`**

After `execHelp` (ends line 28), add:

```ts
function execVersion(bin: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], { encoding: 'utf8', timeout }, (err, stdout, stderr) => {
      if (err) { reject(err); return }
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })
}
```

Then export it — change the line so it reads `export function execVersion(...)` (add `export` to the declaration just written).

- [ ] **Step 4: Add detection + cache to `availability.ts`**

Append below the semver helpers:

```ts
const VERSION_TIMEOUT_MS = 20_000   // matches the existing --help probe timeout

/** Build the "binary not found" status for a CLI. */
function missingStatus(cli: AgentCli): CliStatus {
  return {
    cli, installed: false, binPath: null, version: null,
    minVersion: MIN_CLI_VERSIONS[cli] ?? null, ok: false, reason: 'missing',
  }
}

/** Force-fresh detect ONE CLI. Best-effort: probe failures degrade to `unverified`, never throw. */
export async function detectCli(cli: AgentCli): Promise<CliStatus> {
  const bin = firstUsableCandidate(cli)
  let status: CliStatus
  if (!bin) {
    status = missingStatus(cli)
  } else if (cli === 'coco') {
    // coco has no version floor — identity check is its gate (reuses the cached probe).
    const ok = await verifyCocoAsync(bin)
    status = { cli, installed: true, binPath: bin, version: null, minVersion: null, ok, reason: ok ? 'ok' : 'unverified' }
  } else {
    const min = MIN_CLI_VERSIONS[cli] ?? null
    let out: string | null = null
    try { out = await execVersion(bin, VERSION_TIMEOUT_MS) } catch { out = null }
    const version = out ? extractSemver(out) : null
    if (!version) {
      status = { cli, installed: true, binPath: bin, version: null, minVersion: min, ok: false, reason: 'unverified' }
    } else {
      const ok = min ? semverGte(version, min) : true
      status = { cli, installed: true, binPath: bin, version, minVersion: min, ok, reason: ok ? 'ok' : 'outdated' }
    }
  }
  cache.set(cli, status)
  return status
}

// In-process cache: last detection per CLI. Startup populates it; the Settings on-enable path and
// POST /settings refresh it. A CLI never probed yet reads back as `missing` (conservative).
const cache = new Map<AgentCli, CliStatus>()

/** All CLIs from cache, filling un-probed ones with their `missing` default. */
export function getCachedAvailability(): CliStatus[] {
  return KNOWN_CLIS.map(cli => cache.get(cli) ?? missingStatus(cli))
}

/** The set of currently-`ok` CLIs (from cache). Used to gate seeding + enable validation. */
export function okCliSet(): Set<AgentCli> {
  return new Set(getCachedAvailability().filter(s => s.ok).map(s => s.cli))
}

/** Force-fresh detect ALL known CLIs in parallel; updates the cache. */
export async function detectAllClis(): Promise<CliStatus[]> {
  return Promise.all(KNOWN_CLIS.map(detectCli))
}
```

- [ ] **Step 5: Run the detect test to verify it passes**

Run: `npx vitest run test/availability.test.ts -t "detectCli"`
Expected: PASS.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pty/binaries.ts src/pty/availability.ts test/availability.test.ts
git commit -m "feat(availability): per-CLI detect + in-process cache"
```

---

## Task 3: First-run seeding + relaxed config validation

**Files:**
- Modify: `src/data/agent-config.ts` (`readList`, `cleanList`, `setAgentConfig`, new `seedAgentDefaults`)
- Test: `test/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/availability.test.ts`:

```ts
import { seedAgentDefaults, setAgentConfig, getAgentConfig, type AgentEntry } from '../src/data/agent-config'

function memStore() {
  const m = new Map<string, string>()
  return { getSetting: (k: string) => m.get(k) ?? null, setSetting: (k: string, v: string) => void m.set(k, v) }
}

describe('seedAgentDefaults', () => {
  it('first run enables only ok CLIs', () => {
    const store = memStore()
    seedAgentDefaults(store, new Set(['claude'] as const))
    const list = getAgentConfig(store).list
    expect(list.find(a => a.cli === 'claude')!.enabled).toBe(true)
    expect(list.find(a => a.cli === 'codex')!.enabled).toBe(false)
    expect(list.find(a => a.cli === 'coco')!.enabled).toBe(false)
  })
  it('all-unavailable seeds an all-disabled list that survives readback', () => {
    const store = memStore()
    seedAgentDefaults(store, new Set())
    expect(getAgentConfig(store).list.every(a => !a.enabled)).toBe(true)
  })
  it('does nothing when a list is already stored', () => {
    const store = memStore()
    store.setSetting('agentList', JSON.stringify([{ cli: 'codex', enabled: true, model: null, safeMode: false }, { cli: 'claude', enabled: false, model: null, safeMode: false }, { cli: 'coco', enabled: false, model: null, safeMode: false }]))
    seedAgentDefaults(store, new Set(['claude'] as const))
    expect(getAgentConfig(store).list.find(a => a.cli === 'codex')!.enabled).toBe(true)
  })
})

describe('setAgentConfig with availability', () => {
  const full = (over: Partial<Record<'claude' | 'codex' | 'coco', boolean>>): AgentEntry[] =>
    (['claude', 'codex', 'coco'] as const).map(cli => ({ cli, enabled: over[cli] ?? false, model: null, safeMode: false }))

  it('rejects enabling a CLI that is not ok', () => {
    const store = memStore()
    expect(() => setAgentConfig(store, { list: full({ codex: true }) }, new Set(['claude'] as const)))
      .toThrow(/codex.*not available/i)
  })
  it('allows the enabled CLI when it is ok', () => {
    const store = memStore()
    const cfg = setAgentConfig(store, { list: full({ claude: true }) }, new Set(['claude'] as const))
    expect(cfg.list.find(a => a.cli === 'claude')!.enabled).toBe(true)
  })
  it('allows zero enabled only when nothing is ok', () => {
    const store = memStore()
    expect(() => setAgentConfig(store, { list: full({}) }, new Set())).not.toThrow()
    expect(() => setAgentConfig(store, { list: full({}) }, new Set(['claude'] as const))).toThrow(/at least one/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/availability.test.ts -t "seedAgentDefaults"`
Expected: FAIL — `seedAgentDefaults` not exported.

- [ ] **Step 3: Relax `readList` to keep an all-disabled stored list**

In `src/data/agent-config.ts`, delete line 78 entirely:

```ts
    if (!out.some(a => a.enabled)) return DEFAULT_AGENTS
```

(Rationale: an all-disabled list is now a legitimate persisted state — the all-unavailable case. The structural checks above it still reject genuinely corrupt data.)

- [ ] **Step 4: Add `seedAgentDefaults` + availability-aware validation**

Add this exported function after `DEFAULT_AGENTS` (line 37):

```ts
/** First-run seed: if no agent list is stored yet, write defaults enabling ONLY the `ok` CLIs.
 *  No-op once a list exists, so we never silently rewrite a user's saved config. */
export function seedAgentDefaults(store: Store, okClis: Set<AgentCli>): void {
  if (store.getSetting(LIST_KEY)) return
  const seeded: AgentEntry[] = KNOWN_CLIS.map(cli => ({ cli, enabled: okClis.has(cli), model: null, safeMode: false }))
  store.setSetting(LIST_KEY, JSON.stringify(seeded))
}
```

Change `cleanList` (line 114) to take optional availability and enforce the new rules. Replace its signature and the final `if (!out.some...)` block:

```ts
function cleanList(input: unknown, okClis?: Set<AgentCli>): AgentEntry[] {
  if (!Array.isArray(input)) throw new Error('agent list must be an array')
  const out: AgentEntry[] = []
  const seen = new Set<string>()
  for (const e of input) {
    if (!e || !isCli((e as any).cli)) throw new Error('unknown cli in agent list')
    const cli = (e as any).cli as AgentCli
    if (seen.has(cli)) throw new Error(`duplicate cli "${cli}" in agent list`)
    seen.add(cli)
    out.push({ cli, enabled: (e as any).enabled !== false, model: normModel(cli, (e as any).model), safeMode: (e as any).safeMode === true })
  }
  for (const c of KNOWN_CLIS) if (!seen.has(c)) throw new Error(`agent list must cover all clis (missing "${c}")`)
  if (okClis) {
    for (const a of out) {
      if (a.enabled && !okClis.has(a.cli)) throw new Error(`agent "${a.cli}" is not available (cannot enable)`)
    }
    // Require ≥1 enabled only when at least one CLI is usable; all-unavailable may be all-disabled.
    const anyOk = KNOWN_CLIS.some(c => okClis.has(c))
    if (anyOk && !out.some(a => a.enabled)) throw new Error('at least one agent must be enabled')
  } else if (!out.some(a => a.enabled)) {
    throw new Error('at least one agent must be enabled')
  }
  return out
}
```

Change `setAgentConfig` (line 132) to accept + thread availability:

```ts
export function setAgentConfig(store: Store, patch: AgentConfigPatch, okClis?: Set<AgentCli>): AgentConfig {
  const newList = patch.list !== undefined ? cleanList(patch.list, okClis) : getAgentConfig(store).list
```

(The rest of `setAgentConfig` is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/availability.test.ts`
Expected: PASS (all groups).

- [ ] **Step 6: Verify existing config tests + types still pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; full suite green (live tests stay skipped without `BERTH_LIVE=1`).

- [ ] **Step 7: Commit**

```bash
git add src/data/agent-config.ts test/availability.test.ts
git commit -m "feat(agent-config): availability-aware seeding + enable validation"
```

---

## Task 4: API surface

**Files:**
- Modify: `src/server/api.ts` (GET /settings, new GET /agents/:cli/status, POST /settings)

- [ ] **Step 1: Add the availability imports**

At the top of `src/server/api.ts`, alongside the existing `getAgentConfig`/`setAgentConfig` import, import the availability + detection helpers:

```ts
import { detectCli, detectAllClis, getCachedAvailability, okCliSet } from '../pty/availability'
import { KNOWN_CLIS } from '../data/agent-config'
```

(If `getAgentConfig`/`setAgentConfig` are imported from `'../data/agent-config'` already, add `KNOWN_CLIS` to that existing import instead of duplicating it.)

- [ ] **Step 2: Attach availability to GET /settings**

Replace the `GET /settings` handler body (line 806-809) `agents:` field so the response carries availability:

```ts
api.get('/settings', (_req, res) => {
  const store = getStore()
  res.json({ docsRoot: getDocsRoot(store), locale: getLocale(store), locales: LOCALES, ...getTaskFieldConfig(store), agents: { ...getAgentConfig(store), availability: getCachedAvailability() }, context: getContextConfig(store) })
})
```

- [ ] **Step 3: Add the single-CLI status endpoint**

Immediately after the `GET /settings` handler, add:

```ts
// Force-fresh detect ONE CLI (Settings calls this when the user flips a toggle on). Updates the cache.
api.get('/agents/:cli/status', async (req, res) => {
  const cli = req.params.cli
  if (!(KNOWN_CLIS as string[]).includes(cli)) return res.status(404).json({ error: 'unknown cli' })
  const status = await detectCli(cli as any)
  res.json(status)
})
```

- [ ] **Step 4: Fresh-detect before persisting an agents patch in POST /settings**

Replace the POST `/settings` handler's try-block (line 816-822) so an `agents` patch is validated against a fresh detection:

```ts
api.post('/settings', async (req, res) => {
  const { docsRoot, locale, statuses, priorities, agents, context } = req.body ?? {}
  const store = getStore()
  if (typeof docsRoot === 'string' && docsRoot.trim()) store.setSetting('docsRoot', docsRoot.trim())
  if (typeof locale === 'string') store.setSetting('locale', normalizeLocale(locale))
  try {
    if (statuses !== undefined || priorities !== undefined) setTaskFieldConfig(store, { statuses, priorities })
    if (agents !== undefined) {
      await detectAllClis()             // refresh availability so a just-installed CLI can be enabled
      setAgentConfig(store, agents, okCliSet())
    }
    if (context !== undefined) setContextConfig(store, context)
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'invalid settings' })
  }
  res.json({ ok: true, docsRoot: getDocsRoot(store), locale: getLocale(store), ...getTaskFieldConfig(store), agents: { ...getAgentConfig(store), availability: getCachedAvailability() }, context: getContextConfig(store) })
})
```

(Note: the handler is now `async`. Express handles returned promises' rejections poorly, but every throwable path here is inside the try/catch, so this is safe.)

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(api): expose CLI availability + single-CLI status; validate enables"
```

---

## Task 5: Startup detection + first-run seed

**Files:**
- Modify: `src/server/index.ts` (`start()`)

- [ ] **Step 1: Add imports**

At the top of `src/server/index.ts`, add:

```ts
import { detectAllClis, okCliSet } from '../pty/availability'
import { seedAgentDefaults } from '../data/agent-config'
import { getStore } from '../data/store-singleton'
```

(If `getStore` is already imported in this file, reuse it. Check the existing imports first; adjust the path to match how other `src/server/*` files import the store singleton.)

- [ ] **Step 2: Detect + seed after the server is listening**

In `start()`, inside the `server.listen(...)` callback, add a detached detect-then-seed right before `void warmSessionPool()` (around line 92). Detached so it never delays `listen`; seeding is a no-op once a list exists:

```ts
      // Detect which CLIs are actually usable; first run seeds defaults to only the usable ones.
      // Detached: probing (--version/--help) can take seconds on a cold CLI and must not block listen.
      void detectAllClis()
        .then(() => seedAgentDefaults(getStore(), okCliSet()))
        .catch(() => {})
      void warmSessionPool().catch(() => {})
```

`warmAgentBinaryCaches()` on line 79 stays — it warms the `--help` flag cache used by the launch path; detection here is the availability concern.

- [ ] **Step 3: Verify types compile + boot once**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `PORT=7787 node -e "require('ts-node/register'); require('./src/server/index.ts').start(7787).then(()=>{console.log('booted'); process.exit(0)})" 2>/dev/null || npm start &` then confirm the server logs a `Berth: … sessions` line and exits cleanly with Ctrl-C.
Expected: server boots without throwing. (Manual smoke check — no assertion.)

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(startup): detect CLI availability + seed first-run defaults"
```

---

## Task 6: Frontend types + data default

**Files:**
- Modify: `web/src/lib/api.ts` (types + `agentStatus` client)
- Modify: `web/src/lib/data.tsx` (default `availability: []`)

- [ ] **Step 1: Add the `CliStatus` type + availability field**

In `web/src/lib/api.ts`, after the `AgentCli` type (line 68), add:

```ts
export type CliReason = 'ok' | 'missing' | 'outdated' | 'unverified'
export interface CliStatus {
  cli: AgentCli
  installed: boolean
  binPath: string | null
  version: string | null
  minVersion: string | null
  ok: boolean
  reason: CliReason
}
```

In the `AgentConfig` interface (line 76-81), add the availability field:

```ts
export interface AgentConfig {
  list: AgentEntry[]
  berthAgentCli: AgentCli
  berthAgentModel: string
  headlessClis: AgentCli[]
  availability: CliStatus[]
}
```

- [ ] **Step 2: Add the `agentStatus` client method**

In the `api` object (after `saveSettings`, line 123), add:

```ts
  // Force-fresh single-CLI availability (called when the user enables a CLI in Settings).
  agentStatus: (cli: AgentCli) => getJSON<CliStatus>(`/api/agents/${cli}/status`),
```

- [ ] **Step 3: Give the default config an empty availability**

In `web/src/lib/data.tsx`, update `DEFAULT_AGENTS` (line 70-79) to include `availability: []`:

```ts
const DEFAULT_AGENTS: AgentConfig = {
  list: [
    { cli: 'claude', enabled: true, model: null },
    { cli: 'codex', enabled: true, model: null },
    { cli: 'coco', enabled: true, model: null },
  ],
  berthAgentCli: 'claude',
  berthAgentModel: 'claude-haiku-4-5',
  headlessClis: ['claude', 'codex'],
  availability: [],
}
```

- [ ] **Step 4: Verify the web build typechecks**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/data.tsx
git commit -m "feat(web): CliStatus type + availability on AgentConfig"
```

---

## Task 7: Install-hint copy + availability notice component

**Files:**
- Create: `web/src/lib/agent-install.ts`
- Create: `web/src/components/AgentAvailabilityNotice.tsx`

- [ ] **Step 1: Create the install-hint module**

`web/src/lib/agent-install.ts`:

```ts
import type { AgentCli } from './api'

/** Per-CLI install/upgrade guidance shown when a CLI is missing or outdated. Pure copy. */
export const INSTALL_HINTS: Record<AgentCli, { install: string; docs?: string }> = {
  claude: { install: 'npm i -g @anthropic-ai/claude-code', docs: 'https://docs.claude.com/en/docs/claude-code' },
  codex: { install: 'npm i -g @openai/codex', docs: 'https://github.com/openai/codex' },
  // coco is an internal CLI — replace with the internal install command/URL when available.
  coco: { install: '安装/升级 coco（内部 CLI）' },
}
```

- [ ] **Step 2: Create the notice component**

`web/src/components/AgentAvailabilityNotice.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react'
import type { CliStatus } from '@/lib/api'
import { INSTALL_HINTS } from '@/lib/agent-install'

/** Shown when zero CLIs are usable: tells the user what to install/upgrade.
 *  Renders nothing if at least one CLI is `ok`. */
export function AgentAvailabilityNotice({ availability, className }: { availability: CliStatus[]; className?: string }) {
  if (availability.some((s) => s.ok)) return null
  return (
    <div className={`rounded-md border border-warning/40 bg-warning/10 p-3 text-[12px] text-foreground ${className ?? ''}`}>
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-warning">
        <AlertTriangle size={13} /> 未检测到可用的 CLI agent
      </div>
      <div className="text-text-dim">请安装其中之一后重试：</div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {availability.map((s) => (
          <li key={s.cli} className="flex items-baseline gap-2">
            <span className="w-12 flex-none font-semibold">{s.cli}</span>
            <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px]">{INSTALL_HINTS[s.cli].install}</code>
            {s.reason === 'outdated' && s.version && s.minVersion && (
              <span className="text-text-dim">当前 v{s.version} &lt; 最低 v{s.minVersion}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Verify the web build typechecks**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/agent-install.ts web/src/components/AgentAvailabilityNotice.tsx
git commit -m "feat(web): install-hint copy + AgentAvailabilityNotice"
```

---

## Task 8: Settings — status badges + gated enable

**Files:**
- Modify: `web/src/pages/Settings.tsx`

- [ ] **Step 1: Surface availability + the notice in the Agents card**

In `Settings.tsx`, pull `availability` out of `cfgAgents`. The `agents` config now carries it, so add a derived lookup near line 51 (after `enabledHeadless`):

```ts
  const availability = cfgAgents.availability
  const statusFor = (cli: AgentCli) => availability.find((s) => s.cli === cli)
```

Add the import at the top (with the other component imports, e.g. after line 12):

```ts
import { AgentAvailabilityNotice } from '@/components/AgentAvailabilityNotice'
```

In the `启动 Agents` card (line 139-147), render the notice above the rows and pass `status` to each `AgentRow`:

```tsx
        <Card icon={<Terminal size={14} />} title="启动 Agents" hint="可被起航装载的 CLI">
          <AgentAvailabilityNotice availability={availability} className="mb-1" />
          {agentList.map((agent) => (
            <AgentRow
              key={agent.cli}
              agent={agent}
              status={statusFor(agent.cli)}
              enabledCount={agentList.filter((a) => a.enabled).length}
              onEnable={() => enableAgent(agent.cli)}
              onChange={(patch) => updateAgent(agent.cli, patch)}
            />
          ))}
```

- [ ] **Step 2: Add the on-enable fresh-detect handler**

In the `Settings` component body, after `updateAgent` (line 58), add an `enableAgent` that fresh-detects before flipping the toggle on:

```ts
  // Enabling a CLI re-detects it live (the user may have just installed/upgraded it). Only flip the
  // toggle on if it comes back ok; otherwise surface the reason and leave it off.
  const enableAgent = async (cli: AgentCli) => {
    setAgentError(null)
    try {
      const status = await api.agentStatus(cli)
      if (status.ok) {
        updateAgent(cli, { enabled: true })
      } else {
        const why = status.reason === 'missing' ? '未安装' : status.reason === 'outdated' ? `需升级（当前 v${status.version} < 最低 v${status.minVersion}）` : '无法校验'
        setAgentError(`${cli} 暂不可用：${why}`)
      }
    } catch (e) {
      setAgentError(String((e as any)?.message ?? e))
    }
  }
```

- [ ] **Step 3: Update `AgentRow` to show a badge + gate the toggle**

Replace the `AgentRow` component (line 420-452) with:

```tsx
function AgentRow({
  agent,
  status,
  enabledCount,
  onEnable,
  onChange,
}: {
  agent: AgentEntry
  status: CliStatus | undefined
  enabledCount: number
  onEnable: () => void
  onChange: (patch: Partial<AgentEntry>) => void
}) {
  const ok = status?.ok ?? false
  const canDisable = !agent.enabled || enabledCount > 1
  // Disabling is always allowed (subject to the ≥1 rule); enabling requires the CLI to be usable.
  const toggle = () => {
    if (agent.enabled) { if (canDisable) onChange({ enabled: false }); return }
    onEnable()
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className={cn('w-16 text-[13px] font-semibold', agentTone(agent.cli))}>{agent.cli}</span>
      <AgentStatusBadge status={status} />
      <span className="flex-1" />
      {agent.cli === 'coco' ? (
        <span className="text-[12px] text-text-dim">coco 无 --model</span>
      ) : (
        <input
          value={agent.model ?? ''}
          onChange={(e) => onChange({ model: e.target.value.trim() ? e.target.value : null })}
          placeholder="CLI 默认模型"
          className="w-48 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-text-dim"
        />
      )}
      <Toggle
        on={agent.enabled}
        onChange={toggle}
        disabled={agent.enabled ? !canDisable : !ok}
        title={agent.enabled ? (!canDisable ? '至少保留一个启动 Agent' : '停用') : ok ? '启用' : '不可用，无法启用'}
      />
    </div>
  )
}

function AgentStatusBadge({ status }: { status: CliStatus | undefined }) {
  if (!status) return <span className="text-[11px] text-text-dim">检测中…</span>
  if (status.reason === 'ok') return <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10.5px] text-success">可用{status.version ? ` · v${status.version}` : ''}</span>
  if (status.reason === 'outdated') return <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10.5px] text-warning" title={`当前 v${status.version} < 最低 v${status.minVersion}`}>需升级</span>
  if (status.reason === 'missing') return <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-text-dim">未安装</span>
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-text-dim" title="identity/version 探测失败">无法校验</span>
}
```

- [ ] **Step 4: Import `CliStatus` in Settings**

Update the type import on line 10 to include `CliStatus`:

```ts
import type { AgentCli, AgentEntry, CliStatus } from '@/lib/api'
```

- [ ] **Step 5: Verify the web build typechecks**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 6: Manual check**

Run: `npm start`, open `/app/`, go to 设置. Confirm: each agent row shows a status badge; a missing/outdated CLI's enable toggle is disabled; enabling a usable-but-currently-off CLI works and persists after 保存.
Expected: behaves as described. (Manual — no assertion.)

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "feat(web): agent status badges + availability-gated enable in Settings"
```

---

## Task 9: LaunchDialog — notice when nothing usable

**Files:**
- Modify: `web/src/components/LaunchDialog.tsx`

- [ ] **Step 1: Import the notice**

After line 5 (`import { LaunchConfigFields } ...`), add:

```ts
import { AgentAvailabilityNotice } from './AgentAvailabilityNotice'
```

- [ ] **Step 2: Render the notice in the dialog body when nothing is usable**

In the dialog body, right after the opening `<div className="flex flex-col gap-3 p-4">` (line 144), add:

```tsx
        <AgentAvailabilityNotice availability={agents.availability} />
```

(The component self-hides when any CLI is `ok`, so this only appears in the all-unavailable case.)

- [ ] **Step 3: Sharpen the footer warning copy**

In the `!canSail` warning (line 243-251), change the `enabledAgents.length === 0` branch to point at install rather than "启用"：

```tsx
            {enabledAgents.length === 0
              ? '没有可用的启动 Agent — 请先安装一个 CLI（见上方提示）'
              : dest === 'task' && !taskTitle
                ? '请先选择一个任务'
                : '无项目上下文，请从某个项目里起航'}
```

- [ ] **Step 4: Verify the web build typechecks**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/LaunchDialog.tsx
git commit -m "feat(web): show install notice in LaunchDialog when no CLI usable"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend types + tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; suite green (live `*.live.test.ts` skipped without `BERTH_LIVE=1`).

- [ ] **Step 2: Web types**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 3: End-to-end smoke**

Run: `npm start`, open `/app/`. Confirm in 设置 that badges reflect your real machine (you have `@openai/codex@0.139.0` → codex "可用 · v0.139.0"; claude per its version; coco "未安装" if no `~/.local/bin/coco`). Open 起航 — if at least one CLI is usable, no notice shows and launching works.
Expected: matches reality.

- [ ] **Step 4: Final commit (if any uncommitted verification fixups)**

```bash
git add -A && git commit -m "chore: verify CLI availability detection end-to-end" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** detection (T2) · version floors (T1) · no default-enable of unavailable (T3 seeding + T5 startup) · install prompt (T7/T8/T9) · on-enable re-detect (T4 endpoint + T8 handler) · all-unavailable relaxation (T3 readList + cleanList) · management-agent fallback (already in `getAgentConfig`, unchanged). All covered.
- **Type consistency:** `CliStatus`/`CliReason` defined once in `src/data/agent-config.ts`, mirrored verbatim in `web/src/lib/api.ts`; `detectCli`/`detectAllClis`/`okCliSet`/`getCachedAvailability` names used consistently across T2/T4/T5; `seedAgentDefaults(store, okClis)` and `setAgentConfig(store, patch, okClis?)` signatures consistent across T3/T4/T5.
- **Known follow-ups (out of scope):** version-floor values are placeholders; coco install hint is an internal-CLI placeholder; the frontend `AgentEntry` type intentionally omits `safeMode` (pre-existing — not touched here).
