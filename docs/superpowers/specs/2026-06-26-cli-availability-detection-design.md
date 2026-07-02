# CLI Availability Detection & Install Onboarding — Design

**Date:** 2026-06-26
**Branch:** `release/cli-availability-detection`
**Status:** Approved (pending spec review)

## Problem

Berth assumes the CLI agents it manages (`claude`, `codex`, `coco`) are installed.
`DEFAULT_AGENTS` enables all three, so a fresh install on a machine that has none of
them — or has a broken/outdated one — presents enabled agents that fail at launch time
(a user hit a macOS XProtect "Malware Blocked" deletion of `codex`, leaving no usable
binary, yet the agent still showed enabled).

We need to:

1. **Detect** which CLIs are actually usable on this machine at startup.
2. **Not default-enable** CLIs that are unavailable or below a minimum version.
3. **Prompt the user to install/upgrade** when nothing usable is present.

## Decisions (locked)

- **Detection** = binary resolves on disk/PATH **+** identity check (coco) **+** semver ≥ floor (claude/codex only).
- **When** = every server startup. First run seeds defaults to available-only. UI always
  reflects live state. Unavailable CLIs cannot be toggled on. We never silently rewrite a
  user's saved config.
- **Version floors** apply to `claude` and `codex` only. `coco` stays identity-check only
  (its version scheme is internal/non-standard).
- **Re-detection is on-demand in Settings**, not a manual re-scan button: when a user flips
  a CLI's toggle **on**, the backend force-fresh-detects that single CLI and only enables it
  if it returns `ok`.
- **All-unavailable** is a valid state: the current "≥1 enabled agent" invariant is relaxed
  to allow zero enabled when no CLI is `ok`.

## Approach (chosen: A — backend-authoritative)

Detection lives in the backend (`src/`), folded into the settings round-trip the frontend
already performs. No extra polling endpoint, no re-scan button.

## Data model

```ts
// src/data/agent-config.ts
export type CliReason = 'ok' | 'missing' | 'outdated' | 'unverified'
export interface CliStatus {
  cli: AgentCli
  installed: boolean         // binary resolved on disk/PATH
  binPath: string | null
  version: string | null     // parsed from --version (claude/codex); null for coco
  minVersion: string | null  // requirement (null for coco)
  ok: boolean                // installed && identity-ok && version>=min
  reason: CliReason          // why not ok, for UI copy
}

export const MIN_CLI_VERSIONS: Partial<Record<AgentCli, string>> = {
  claude: '1.0.0',   // conservative placeholder, tune later
  codex:  '0.40.0',  // conservative placeholder, tune later
}
```

`reason` meanings:
- `missing` — binary not found.
- `outdated` — found, but `version < minVersion`.
- `unverified` — found, but identity/`--version` probe failed (coco identity mismatch, or
  `--version` unparseable/timed out).
- `ok` — usable.

## Backend

### Detection module — `src/pty/availability.ts` (new)

```ts
detectCli(cli: AgentCli): Promise<CliStatus>       // one CLI, force-fresh
detectAvailableClis(): Promise<CliStatus[]>         // all KNOWN_CLIS, parallel
getCachedAvailability(): CliStatus[]                // from cache, fast
```

Per-CLI logic, reusing existing primitives in `src/pty/binaries.ts`:
- `firstUsableCandidate(cli)` → null ⇒ `{installed:false, reason:'missing'}`.
- `claude`/`codex`: run `<bin> --version` (20s timeout, same pattern as `warmCliHelp`),
  extract semver via `/(\d+\.\d+\.\d+)/`, compare to `MIN_CLI_VERSIONS[cli]`.
  Unparseable/timeout ⇒ `reason:'unverified'`; below floor ⇒ `reason:'outdated'`;
  at/above floor ⇒ `ok`.
- `coco`: `verifyCocoAsync()` identity → pass ⇒ `ok`, fail ⇒ `unverified`. No version gate.

**Caching:** module-level `Map<AgentCli, CliStatus>` + timestamp. Populated at startup
(folded into `warmAgentBinaryCaches()` in `src/server/index.ts`). `--version` outputs cached
like the existing `--help` cache so we never re-spawn per request. `detectCli` (single,
force-fresh) updates the cache entry for that CLI.

Detection is **best-effort**: a `--version` spawn timeout/crash yields `reason:'unverified'`
and never throws into startup (mirrors the fire-and-forget `--help` warm).

### Config seeding & validation — `src/data/agent-config.ts`

- **First-run seed:** when no `agentList` is stored, seed `DEFAULT_AGENTS` with
  `enabled = status.ok` per CLI (instead of all-true). Startup computes availability once and
  passes it into the seed path.
- **Relax the "≥1 enabled" invariant:** zero enabled is allowed **only when no CLI is `ok`**;
  otherwise still require ≥1 enabled.
- **Reject enabling an unusable CLI:** `setAgentConfig` fresh-detects each `enabled:true`
  entry; if that CLI isn't `ok`, reject with `{error, cli, reason}` (defense-in-depth against
  a stale UI).
- **Management agent (`berthAgentCli`):** if the chosen management CLI becomes unavailable,
  fall back to the first `ok` headless CLI, or `null` if none — so a missing CLI never wedges
  title/summary generation.

### API surface — `src/server/api.ts`

- `GET /api/settings` → add `availability: CliStatus[]` (served from cache, fast).
- `GET /api/agents/:cli/status` (new) → force-fresh-detect a single CLI; Settings calls it
  when the user attempts to enable that row.
- `POST /api/settings` → enforce the validation above; structured error `{error, cli, reason}`
  on rejection.
- No `/api/refresh` re-detection wiring; no re-scan button.

## Frontend — `web/src/`

### `lib/data.tsx`
Extend the settings load to capture `availability: CliStatus[]` and expose it via context
alongside `agents`. Add an `installHints` map (per-CLI install/upgrade command + docs link),
kept frontend-side since it's pure copy:
- `claude` → `npm i -g @anthropic-ai/claude-code`
- `codex` → `npm i -g @openai/codex` (or `brew install codex`)
- `coco` → internal install link (placeholder)

### `pages/Settings.tsx`
Each agent row gains a **status badge** driven by `CliStatus.reason`:
- `ok` → ✅ 可用 (+ version)
- `outdated` → ⬇️ 需升级（当前 vX < 最低 vY）+ upgrade command
- `missing` → ❌ 未安装 + install command
- `unverified` → ⚠️ 无法校验 (identity/version probe failed)

When `reason !== 'ok'` the **enable toggle is disabled** with the hint shown. When the user
flips a toggle **on**, call `GET /api/agents/:cli/status` (fresh detect), update that row, and
only persist the enable if it returns `ok`; otherwise surface the reason inline. The per-CLI
model input is unchanged.

### Empty-state — `<AgentAvailabilityNotice>` (new, reusable)
Shown in **Settings** (top banner) and in **`LaunchDialog`** when zero CLIs are `ok`.
Copy: "未检测到可用的 CLI agent，请安装其中之一后重试" + the three install commands.

### `components/LaunchDialog.tsx`
`enabledAgents` already filters by `enabled`; with seeding fixed it is naturally empty when
nothing's usable. Replace the bare "no agents enabled" warning with
`<AgentAvailabilityNotice>` so the launch path also guides install.

## Error handling & edge cases

- `--version` spawn timeout/crash → `reason:'unverified'`; never throws into startup.
- All-unavailable: seeding yields zero enabled; `setAgentConfig` permits zero-enabled here;
  `berthAgentCli` falls back to `null`; UI shows the notice; launching is blocked gracefully.
- Stale UI race (browser cached `ok`, CLI since removed): `POST /api/settings` fresh-detect
  rejects with `{error, cli, reason}`; UI shows it.
- coco cold flakiness (known 4–15s `--help`): identity failure ⇒ `unverified`, not a hard
  error; user retries by re-toggling (fresh detect).

## Testing

New `test/availability.test.ts` + extensions to `test/binaries.test.ts` patterns
(unit-level, mock detection — not gated behind `BERTH_LIVE=1`):
- `detectCli` for each `reason`: missing (no candidate), outdated (mock `--version` below
  floor), ok (≥ floor), unverified (unparseable version / coco identity fail).
- Semver extraction from real-ish `--version` strings (`codex-cli 0.139.0`, claude's format).
- Seeding: no stored list + mixed availability ⇒ only `ok` CLIs enabled.
- `setAgentConfig`: rejects enabling a non-`ok` CLI; allows zero-enabled only when all
  unavailable; management-agent fallback when chosen CLI unavailable.

## Files touched

| Area | File | Change |
|------|------|--------|
| Detection | `src/pty/availability.ts` | **new** — `detectCli`, `detectAvailableClis`, cache |
| Primitives | `src/pty/binaries.ts` | reuse `firstUsableCandidate`, `verifyCocoAsync`; add `--version` probe/cache |
| Config | `src/data/agent-config.ts` | `CliStatus`, `MIN_CLI_VERSIONS`, seeding, validation, mgmt fallback |
| Startup | `src/server/index.ts` | compute availability in `warmAgentBinaryCaches()`, pass to seed |
| API | `src/server/api.ts` | `availability` in GET; new `GET /api/agents/:cli/status`; POST validation |
| FE state | `web/src/lib/data.tsx` | capture `availability`, `installHints` |
| FE settings | `web/src/pages/Settings.tsx` | status badges, gated toggle, on-enable fresh detect |
| FE empty | `web/src/components/AgentAvailabilityNotice.tsx` | **new** reusable notice |
| FE launch | `web/src/components/LaunchDialog.tsx` | swap warning for notice |
| Tests | `test/availability.test.ts` | **new** unit coverage |

## Out of scope

- Auto-installing CLIs on the user's behalf.
- Per-CLI version floors beyond claude/codex.
- A manual "re-scan" UI control (re-detection is on startup + on enable-toggle only).
