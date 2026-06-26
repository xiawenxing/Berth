# Per-agent safe mode — design

**Date:** 2026-06-26
**Branch:** `release/per-agent-safe-mode`
**Status:** Approved (design)

## Problem

Berth launches all three CLI agents (`claude`, `codex`, `coco`) with their
maximum-permission / approval-bypass flags by default, because Berth-launched
sessions run unattended:

| Agent | Flag injected today | Where |
| --- | --- | --- |
| claude | `--dangerously-skip-permissions` | `src/pty/launch.ts:101` (`freshArgv`) |
| coco | `--yolo` | `src/pty/launch.ts:111` (`freshArgv`) |
| codex | `--dangerously-bypass-approvals-and-sandbox` | `src/pty/launch.ts:120` (`freshArgv`) |

There is no way to opt a given agent into a safer, approval-prompting launch.

## Goal

Add a **per-agent "safe mode" toggle** in Settings. When ON for an agent, Berth
omits that agent's approval-bypass flag so the CLI falls back to its **own
native default** (which prompts for tool/edit approval). When OFF, behavior is
unchanged (max permission).

**Default is OFF for every agent** — a fresh install / existing config still
launches at max permission. Safe mode is strictly opt-in.

## Scope decision: interactive (Model A) launches only

Safe mode changes **only the Model A interactive PTY launch path** (`freshArgv`),
where the user is attached to a real web terminal and can answer approval
prompts.

It does **not** affect:

- `freshArgvStream` (Model B claude stream-json) — permission requests arrive as
  stream control messages with no driver-side answer path; dropping the bypass
  flag would hang the turn.
- `codexTurnArgv` / `cocoTurnArgv` (Model B per-turn spawn) — no terminal to
  answer prompts.
- `src/agent/index.ts` headless agents (title generation, context summary) — by
  definition unattended.

These paths always keep their max-permission flags. This matches the rule that
safe mode only makes sense where a human can respond to a prompt.

The default new-session launch (`pty-ws.ts` → `launchFresh` → `freshArgv`) is
Model A, so safe mode covers the normal interactive session-creation flow. Model
B stream is opt-in via `rendersStream(url, cli)` and is treated as unattended for
permission purposes.

## Design

### 1. Data model — `src/data/agent-config.ts`

Add `safeMode: boolean` to `AgentEntry` (alongside `enabled`, `model`):

```ts
export interface AgentEntry {
  cli: AgentCli
  enabled: boolean
  model: string | null
  safeMode: boolean   // ON → omit the approval-bypass flag on Model A launch. Default false.
}
```

- `readList` validation: parse `safeMode` as boolean; **default `false` when
  absent** so existing persisted configs (no field) stay max-permission.
- `setAgentConfig` already serializes the whole `list` to the `agentList`
  `app_setting` row as JSON — the new field rides along; just ensure the
  validation/normalization in the write path preserves it.

### 2. API — `src/server/api.ts`

`GET /api/settings` returns `agents: getAgentConfig(store)` and `POST
/api/settings` writes `agents` via `setAgentConfig`. Once `safeMode` is in
`AgentEntry`, it flows through both automatically. Verify the POST path does not
strip unknown fields (normalize each incoming entry to include `safeMode`).

### 3. Launch threading — `src/pty/launch.ts` + `src/server/pty-ws.ts`

- Add `safeMode?: boolean` to `FreshOpts`.
- In `pty-ws.ts`, the Model A branch builds `freshOpts` (around line 502); add
  `safeMode: agentEntry.safeMode`.
- In `freshArgv`, make each bypass flag conditional:

```ts
// claude
...(o.safeMode ? [] : ['--dangerously-skip-permissions']),
// coco
...(o.safeMode ? [] : ['--yolo']),
// codex
...(o.safeMode ? [] : ['--dangerously-bypass-approvals-and-sandbox']),
```

  For codex, keep `--profile CODEX_BERTH_PROFILE`,
  `--dangerously-bypass-hook-trust` (when `injectFile` present), and
  `--no-alt-screen` unchanged — safe mode flips only the approvals/sandbox flag,
  not profile/manifest loading.

- `freshArgvStream`, `codexTurnArgv`, `cocoTurnArgv`, and `src/agent/index.ts`
  are **not** modified.

### 4. Frontend — `web/src/pages/Settings.tsx`

- In `AgentRow`, add a second `Toggle` labelled **"安全模式"** next to the
  enabled toggle, with help text: *"开启后该 agent 每次工具调用前请求授权（仅交互式会话生效）"*.
- Add `safeMode` to the web-side `AgentEntry` / `AgentConfig` TS types and
  include it in the `saveSettings({ agents: { list, ... } })` payload.
- Default rendering reflects `false`.

## Behavior when safe mode is ON (per CLI)

- **claude** — no `--dangerously-skip-permissions` → claude's default permission
  mode; prompts for tool approval in the terminal. (Trust dialog stays
  pre-seeded via `pty/trust.ts`.)
- **codex** — no `--dangerously-bypass-approvals-and-sandbox` → codex uses its
  configured default approval policy + sandbox; the inline TUI prompts.
- **coco** — no `--yolo`/`-y` → coco's default approval behavior; prompts in the
  terminal.

## Testing

- `freshArgv` unit tests: for each of claude/codex/coco, assert the bypass flag
  is **present** when `safeMode` is false/undefined and **absent** when
  `safeMode` is true; assert non-permission flags (profile, model, `--no-alt-screen`,
  `--add-dir`, positional prompt) are unaffected.
- `agent-config` round-trip: write an entry with `safeMode: true`, read it back;
  assert a stored entry **missing** `safeMode` reads back as `false` (backward
  compat).
- Existing `freshArgvStream` / per-turn / headless tests remain green (unchanged).

## Open verification item (implementation time)

Confirm codex launches cleanly in interactive TUI when the dangerous flag is
dropped but `--profile` + `--dangerously-bypass-hook-trust` are retained (i.e.
the profile/manifest still loads and codex falls back to prompting rather than
erroring on a missing approval mode). Adjust if codex requires an explicit
`--ask-for-approval` / `--sandbox` to start.

## Out of scope

- Intermediate permission tiers (e.g. claude `acceptEdits`, codex
  `workspace-write` only) — binary safe/max for v1.
- Safe mode for Model B / per-turn / headless paths.
- A global master switch — toggles are strictly per-agent.
