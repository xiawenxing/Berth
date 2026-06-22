# `BERTH_TEST_HOME` — simulate a clean first-install environment locally

**Date:** 2026-06-22
**Status:** Approved (design)
**Branch:** `release/berth-2.0-ia`

## Problem

Polishing Berth's first-install / initialization chain (empty sidebar, onboarding, bootstrap/seed,
Settings, launching the very first session) requires running Berth *as if freshly installed on a
clean machine*. Today there is no faithful way to do that locally:

- **`BERTH_HOME`** (`src/paths.ts`) isolates only Berth's *own* state (sqlite db, docs root, seed).
  Its own doc-comment admits the gap: `storeRoots()` (`src/server/store-singleton.ts:108`) still
  reads the CLI session stores (`~/.claude/projects`, `~/.codex`, coco cache) straight from
  `homedir()`. So an "isolated" Berth still shows your real hundreds of sessions in the sidebar —
  nothing like a fresh install's empty first screen.
- **Overriding `HOME`** would empty everything, but `binaries.ts` builds its `CANDIDATES` list from
  `homedir()` *at import time* (`src/pty/binaries.ts:7-11`). With `HOME` pointed at an empty test
  dir those candidate paths resolve into nothing, so Berth can no longer find the CLI binaries —
  you can't launch a session in the "clean" environment, defeating the purpose.

We need one switch that makes Berth behave like a fresh install — **empty session sidebar, isolated
Berth state, and a launch loop that still works** — without touching the user's real data.

## Goal / Acceptance

A single env var, **`BERTH_TEST_HOME`**, that when set to a directory:

1. Isolates Berth's own state under it (db/docs/seed) — superset of today's `BERTH_HOME`.
2. Points the session scan (`storeRoots()`) at it → the sidebar starts genuinely empty.
3. Keeps resolving CLI binaries from the **real** home, so launching still works.
4. Closes the loop: a session launched from the clean instance writes its session files **into the
   test home** and therefore appears in the (previously empty) sidebar — end-to-end fresh-machine
   simulation.

When `BERTH_TEST_HOME` is unset, behavior is byte-for-byte identical to today.

Deliverable: code (`src/`) + usage docs.

## Non-goals

- Full machine isolation (e.g. redirecting `berth skill install` targets, KMS, or anything outside
  the run-clean flow). `skill-install.ts` stays on the real home.
- Any change to production runtime behavior when the var is unset.
- A test-only fixture framework. This is a developer convenience switch, not a CI harness.

## Design

### The mechanism: a "fake `$HOME` for data, real `$HOME` for binaries"

`BERTH_TEST_HOME` acts as a fake home that Berth uses for **all data/config/session path
resolution** and for **spawned CLI children's `HOME`**, while **binary resolution deliberately keeps
using the real `homedir()`**. That split is the whole point — it's why a dedicated var beats simply
overriding `HOME`.

### 1. New helper in `src/paths.ts`

```ts
/**
 * Home dir used for resolving Berth's DATA/CONFIG/SESSION paths (Berth state, the CLI session stores
 * Berth scans, the config Berth reads/writes on launch, and the HOME handed to spawned CLI children).
 * Defaults to the real home; override with BERTH_TEST_HOME to simulate a clean first-install machine.
 * Binary resolution (src/pty/binaries.ts) intentionally does NOT use this — it must find the real
 * installed CLIs — which is why BERTH_TEST_HOME works where overriding HOME breaks launching.
 */
export function dataHome(): string {
  return process.env.BERTH_TEST_HOME || homedir()
}
```

`berthHome()` default branch changes from `join(homedir(), '.berth')` to `join(dataHome(), '.berth')`.
Precedence is preserved: an explicit `BERTH_HOME` still wins, so existing isolated-instance setups
are unaffected. With only `BERTH_TEST_HOME` set, Berth state lands at `$BERTH_TEST_HOME/.berth`.

### 2. Callsites swapped `homedir()` → `dataHome()` (data/config paths only)

| File | Symbol | Effect |
|------|--------|--------|
| `src/server/store-singleton.ts` | `storeRoots()` (claude/codex/coco roots) | empty sidebar — the core change |
| `src/pty/launch.ts` | `codexHome()` | codex profile + resume read/write under test home |
| `src/pty/trust.ts` | `CLAUDE_CONFIG` (`~/.claude.json`) | claude trust written where the test-home child reads it |
| `src/pty/coco-hook.ts` | `traeConfigPath()` | coco/trae hook config consistent with test home |

`ensureLaunchCwd()`'s `homedir()` *fallback cwd* (`launch.ts:27`) stays on the real home — it is a
last-resort spawn directory, not a data path.

### 3. Closing the launch loop — child env in `src/pty/launch.ts`

A small helper, used by **both** `launchFresh` and `resumeSession`:

```ts
function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!process.env.BERTH_TEST_HOME) return base
  return { ...base, HOME: process.env.BERTH_TEST_HOME, CODEX_HOME: codexHome() }
}
```

- `launchFresh` already builds an `env` object — wrap its final env through `childEnv`.
- `resumeSession` currently passes `env: process.env as any` directly — route it through `childEnv`.

Because `resolveAgentBinary()` returns an **absolute** path resolved from the real home *before*
spawn, handing the child a fake `HOME` is safe — the binary is still found. With `HOME` pointed at
the test home, claude writes to `$BERTH_TEST_HOME/.claude/projects`, coco to
`$BERTH_TEST_HOME/Library/Caches/coco`, and codex to `$BERTH_TEST_HOME/.codex` (via `CODEX_HOME`) —
exactly the roots `storeRoots()` now scans, so a launched session surfaces in the clean sidebar.

### 4. Deliberately untouched (stays on real `homedir()`)

- `src/pty/binaries.ts` `CANDIDATES` — must locate the real installed CLIs.
- `src/skill-install.ts` `detectAgentSkillDirs()` — `berth skill install` is a separate command,
  outside the run-clean flow.

## Data flow (clean run)

```
BERTH_TEST_HOME=/tmp/berth-clean npm start
  paths.dataHome()      -> /tmp/berth-clean
  berthHome()           -> /tmp/berth-clean/.berth         (db/docs/seed isolated)
  storeRoots()          -> /tmp/berth-clean/{.claude/projects, .codex, Library/Caches/coco}
                           (all empty -> sidebar empty -> first-run UI)
  binaries.resolveAgentBinary('claude') -> /Users/<me>/.local/bin/claude   (REAL home)
  launchFresh(...) spawn(absBin, argv, { env: { ...HOME=/tmp/berth-clean, CODEX_HOME=.../.codex } })
                           -> claude writes /tmp/berth-clean/.claude/projects/...
  refresh() re-scans storeRoots() -> the new session appears in the sidebar
```

## Testing

Unit tests (set/restore `process.env` around each case; never leak env between tests):

- `dataHome()` returns `BERTH_TEST_HOME` when set, `homedir()` when unset.
- `berthHome()` precedence: `BERTH_HOME` wins over `BERTH_TEST_HOME`; with only `BERTH_TEST_HOME`
  set, returns `$BERTH_TEST_HOME/.berth`; with neither, `~/.berth`.
- `storeRoots()` reflects `BERTH_TEST_HOME` for all three roots, and the real home when unset.

Guard: confirm `binaries.ts` candidate resolution is unaffected by `BERTH_TEST_HOME` (it reads
`homedir()` only). `CANDIDATES` is computed at import, so this is inherently true — assert it via a
focused test if cheap, otherwise document the invariant.

Manual smoke (also the documented recipe):

```bash
mkdir -p /tmp/berth-clean
BERTH_TEST_HOME=/tmp/berth-clean npm start   # empty sidebar + first-run UI
# launch a claude session from the UI -> it appears in the sidebar
rm -rf /tmp/berth-clean                       # reset to a clean slate
```

## Docs

- Rewrite the `src/paths.ts` doc-comment: the existing "override `HOME` but it breaks binaries"
  caveat is now resolved by `BERTH_TEST_HOME`; document `dataHome()` and the data-vs-binary split.
- Add a short how-to (the recipe above) — either a new `docs/testing-clean-first-run.md` or a
  section in `docs/ARCHITECTURE.md`. Decide during planning; prefer ARCHITECTURE.md if a natural
  home exists, else a dedicated file linked from it.
- Add a convenience npm script `dev:clean` to `package.json`, e.g.
  `BERTH_TEST_HOME="${BERTH_TEST_HOME:-/tmp/berth-clean}" npm start`, so the switch is one command.

## Risks / edge cases

- **Trust/profile coherence:** if `trust.ts` / codex profile writes did *not* follow `dataHome()`,
  the child (with `HOME`=test) would see no trust / no `berth-launch` profile and re-prompt or skip
  injection. Routing all four data callsites through `dataHome()` keeps them consistent. (codex
  degrades gracefully if the profile is missing, but we make it correct, not merely safe.)
- **Test-home dir must exist:** the recipe `mkdir`s it. Berth already creates `berthHome()`
  subdirs on demand; the CLI children create their own stores. No extra bootstrapping needed.
- **Env leakage in tests:** all env-mutating tests must restore `process.env` in a `finally`/teardown.
```
