# Per-agent Safe Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-agent "safe mode" toggle in Settings that, when ON, makes that CLI launch without its approval-bypass flag (falling back to its native prompts-for-approval default) on interactive Model A launches only; default OFF (max permission).

**Architecture:** Add a `safeMode: boolean` field to the per-agent config (`AgentEntry`), persisted in the existing `agentList` `app_setting` row. Thread it into `FreshOpts` and make `freshArgv` emit the bypass flag conditionally. The Settings UI gets a second per-agent toggle. Model B stream / per-turn / headless launch paths are untouched and always run at max permission.

**Tech Stack:** TypeScript, Node, Vitest (backend `test/`), React + Vite + Tailwind (`web/`), SQLite `app_setting` store.

**Spec:** `docs/superpowers/specs/2026-06-26-per-agent-safe-mode-design.md`

---

## File Structure

- `src/data/agent-config.ts` — add `safeMode` to `AgentEntry`, `DEFAULT_AGENTS`, `readList`, `cleanList`.
- `src/pty/launch.ts` — add `safeMode?` to `FreshOpts`; gate the bypass flag in `freshArgv`.
- `src/server/pty-ws.ts` — pass `safeMode: agentEntry.safeMode` into the Model A `freshOpts`.
- `web/src/lib/api.ts` — add `safeMode` to the web `AgentEntry` type.
- `web/src/lib/data.tsx` — add `safeMode: false` to each `DEFAULT_AGENTS` entry.
- `web/src/pages/Settings.tsx` — render a per-agent safe-mode toggle in `AgentRow`.
- `test/agent-config.test.ts` — round-trip + backward-compat tests.
- `test/launch.test.ts` — argv tests for safeMode on/off across all three CLIs.

---

### Task 1: Backend data model — `safeMode` on `AgentEntry`

**Files:**
- Modify: `src/data/agent-config.ts:30-36` (interface + `DEFAULT_AGENTS`), `:73` (`readList`), `:122` (`cleanList`)
- Test: `test/agent-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these to `test/agent-config.test.ts` inside the `describe('data/agent-config', ...)` block:

```ts
it('defaults safeMode to false for every agent', () => {
  const store = openStore(':memory:')
  const cfg = getAgentConfig(store)
  expect(cfg.list.every(a => a.safeMode === false)).toBe(true)
})

it('round-trips safeMode per agent', () => {
  const store = openStore(':memory:')
  setAgentConfig(store, {
    list: [
      { cli: 'claude', enabled: true, model: null, safeMode: true },
      { cli: 'codex', enabled: true, model: null, safeMode: false },
      { cli: 'coco', enabled: true, model: null, safeMode: true },
    ],
  })
  const cfg = getAgentConfig(store)
  expect(cfg.list.find(a => a.cli === 'claude')!.safeMode).toBe(true)
  expect(cfg.list.find(a => a.cli === 'codex')!.safeMode).toBe(false)
  expect(cfg.list.find(a => a.cli === 'coco')!.safeMode).toBe(true)
})

it('reads a stored entry missing safeMode as false (backward compat)', () => {
  const store = openStore(':memory:')
  // simulate an older persisted list with no safeMode field
  store.setSetting('agentList', JSON.stringify([
    { cli: 'claude', enabled: true, model: null },
    { cli: 'codex', enabled: true, model: null },
    { cli: 'coco', enabled: true, model: null },
  ]))
  const cfg = getAgentConfig(store)
  expect(cfg.list.every(a => a.safeMode === false)).toBe(true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/agent-config.test.ts`
Expected: FAIL — `safeMode` is `undefined` (property does not exist on the returned entries).

- [ ] **Step 3: Add `safeMode` to the interface and defaults**

In `src/data/agent-config.ts`, change the `AgentEntry` interface (lines 30-34):

```ts
export interface AgentEntry {
  cli: AgentCli
  enabled: boolean
  model: string | null   // default model for a FRESH launch; null = the CLI's own default
  safeMode: boolean       // ON → omit the approval-bypass flag on interactive (Model A) launch. Default false.
}
```

And `DEFAULT_AGENTS` (line 36):

```ts
export const DEFAULT_AGENTS: AgentEntry[] = KNOWN_CLIS.map(cli => ({ cli, enabled: true, model: null, safeMode: false }))
```

- [ ] **Step 4: Parse `safeMode` in `readList` and `cleanList`**

In `readList`, change the push (line 73) to:

```ts
      out.push({ cli: e.cli, enabled: e.enabled !== false, model: normModel(e.cli, e.model), safeMode: e.safeMode === true })
```

In `cleanList`, change the push (line 122) to:

```ts
    out.push({ cli, enabled: (e as any).enabled !== false, model: normModel(cli, (e as any).model), safeMode: (e as any).safeMode === true })
```

(`=== true` means a missing/non-boolean value reads as `false` — this gives the backward-compat default.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/agent-config.test.ts`
Expected: PASS (all tests, including the pre-existing ones — they only assert specific fields, so the added `safeMode` does not break them).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/data/agent-config.ts test/agent-config.test.ts
git commit -m "feat(agent-config): add per-agent safeMode field (default false)"
```

---

### Task 2: Launch argv — gate the bypass flag on `safeMode`

**Files:**
- Modify: `src/pty/launch.ts:71-76` (`FreshOpts`), `:99-127` (`freshArgv`)
- Test: `test/launch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/launch.test.ts` (it already imports `freshArgv`):

```ts
it('claude: safeMode omits --dangerously-skip-permissions', () => {
  const a = freshArgv('claude', { cwd: '/c', sessionId: 'uuid-1', safeMode: true })
  expect(a).toEqual(['--session-id', 'uuid-1'])
  expect(a).not.toContain('--dangerously-skip-permissions')
})

it('coco: safeMode omits --yolo', () => {
  const a = freshArgv('coco', { cwd: '/c', sessionId: 'uuid-1', safeMode: true })
  expect(a).toEqual(['--session-id', 'uuid-1'])
  expect(a).not.toContain('--yolo')
})

it('codex: safeMode omits the approvals/sandbox bypass but keeps --no-alt-screen', () => {
  const a = freshArgv('codex', { cwd: '/c', safeMode: true })
  expect(a).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  expect(a).toContain('--no-alt-screen')
})

it('safeMode false/undefined keeps the bypass flag (default = max permission)', () => {
  expect(freshArgv('claude', { cwd: '/c' })).toContain('--dangerously-skip-permissions')
  expect(freshArgv('coco', { cwd: '/c' })).toContain('--yolo')
  expect(freshArgv('codex', { cwd: '/c' })).toContain('--dangerously-bypass-approvals-and-sandbox')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/launch.test.ts`
Expected: FAIL — `safeMode: true` still emits the bypass flag (the safeMode cases fail; the "default keeps the flag" case already passes).

- [ ] **Step 3: Add `safeMode` to `FreshOpts`**

In `src/pty/launch.ts`, extend the `FreshOpts` interface (lines 71-76):

```ts
export interface FreshOpts {
  cwd: string; sessionId?: string; injectFile?: string
  initialPrompt?: string   // the user's first message (positional prompt)
  model?: string           // per-CLI default model (claude/codex only; coco has no --model flag)
  safeMode?: boolean       // ON → omit the approval-bypass flag (interactive Model A only). Default/undefined = max permission.
  addDirs?: string[]; cols?: number; rows?: number
}
```

- [ ] **Step 4: Gate the bypass flag in `freshArgv`**

In `freshArgv`, replace the three unconditional bypass-flag lines:

claude (line 101):

```ts
      ...(o.safeMode ? [] : ['--dangerously-skip-permissions']),  // bypass-permissions unless safe mode; Berth-launched sessions run unattended
```

coco (line 111):

```ts
        ...(o.safeMode ? [] : ['--yolo']),                        // bypass tool permission checks unless safe mode
```

codex (line 120):

```ts
        ...(o.safeMode ? [] : ['--dangerously-bypass-approvals-and-sandbox']),  // bypass approvals + sandbox unless safe mode
```

Leave codex's `--profile` / `--dangerously-bypass-hook-trust` (line 119) and `--no-alt-screen` (line 121) unchanged — safe mode flips only the approvals/sandbox flag, not profile/manifest loading.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/launch.test.ts`
Expected: PASS — including the pre-existing exact-array tests (e.g. `claude: session-id + bypass + system-prompt-file + add-dir`), which pass no `safeMode` so the flag is still present.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/pty/launch.ts test/launch.test.ts
git commit -m "feat(launch): omit approval-bypass flag when freshArgv safeMode is set"
```

---

### Task 3: Wire `safeMode` from agent config into the Model A launch

**Files:**
- Modify: `src/server/pty-ws.ts:502-511` (the `freshOpts` object in the Model A branch)

- [ ] **Step 1: Thread `safeMode` into `freshOpts`**

In `src/server/pty-ws.ts`, the Model A branch builds `freshOpts` (around line 502). `agentEntry` is already resolved earlier in the handler (`const agentEntry = agentCfg.list.find(a => a.cli === cli)`). Add the `safeMode` line next to `model`:

```ts
    const freshOpts = {
      cwd,
      sessionId: plan.sessionId ?? undefined,
      injectFile,
      initialPrompt: initialPrompt ?? undefined,
      model: agentEntry.model ?? undefined,   // per-CLI default model (claude/codex; coco ignores)
      safeMode: agentEntry.safeMode,           // per-CLI safe mode → freshArgv drops the bypass flag (Model A only)
      addDirs: finalAddDirs,
      cols,
      rows,
    }
```

Do **not** touch the Model B stream branch (`makeFreshStreamDriver`, ~line 480) — it stays max permission by design.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`freshOpts` is consumed by `launchFresh` → `freshArgv`, both already accept the new optional field.)

- [ ] **Step 3: Verify the Model B branch is unchanged**

Run: `git diff src/server/pty-ws.ts`
Expected: the only change is the added `safeMode:` line inside the Model A `freshOpts` object; the `makeFreshStreamDriver` call is untouched.

- [ ] **Step 4: Run the existing pty-ws tests**

Run: `npx vitest run test/pty-ws.new.test.ts`
Expected: PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/server/pty-ws.ts
git commit -m "feat(pty-ws): pass per-agent safeMode into Model A launch options"
```

---

### Task 4: Frontend types + default

**Files:**
- Modify: `web/src/lib/api.ts:70-74` (`AgentEntry`)
- Modify: `web/src/lib/data.tsx:69-74` (`DEFAULT_AGENTS`)

- [ ] **Step 1: Add `safeMode` to the web `AgentEntry` type**

In `web/src/lib/api.ts` (lines 70-74):

```ts
export interface AgentEntry {
  cli: AgentCli
  enabled: boolean
  model: string | null
  safeMode: boolean
}
```

- [ ] **Step 2: Add `safeMode: false` to each web default agent**

In `web/src/lib/data.tsx` (`DEFAULT_AGENTS`, lines 69-74):

```ts
const DEFAULT_AGENTS: AgentConfig = {
  list: [
    { cli: 'claude', enabled: true, model: null, safeMode: false },
    { cli: 'codex', enabled: true, model: null, safeMode: false },
    { cli: 'coco', enabled: true, model: null, safeMode: false },
  ],
```

(Leave the rest of the `DEFAULT_AGENTS` object — `berthAgentCli`, `berthAgentModel`, `headlessClis` — unchanged.)

- [ ] **Step 3: Typecheck the web project**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: clean — no other web call site constructs an `AgentEntry` literal that now lacks `safeMode` (the Settings page builds entries by spreading existing ones via `updateAgent`). If tsc flags a literal, add `safeMode: false` there.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/data.tsx
git commit -m "feat(web): add safeMode to AgentEntry type and defaults"
```

---

### Task 5: Settings UI — per-agent safe-mode toggle

**Files:**
- Modify: `web/src/pages/Settings.tsx:420-452` (`AgentRow`)

- [ ] **Step 1: Render a safe-mode toggle in `AgentRow`**

In `web/src/pages/Settings.tsx`, the `AgentRow` body currently ends with the enabled `Toggle` (lines 444-449). Add a labelled safe-mode toggle just before the enabled toggle so each agent row reads: `name … model … [安全] safeMode-toggle … enabled-toggle`. Replace the `AgentRow` return block (lines 430-451) with:

```tsx
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className={cn('w-16 text-[13px] font-semibold', agentTone(agent.cli))}>{agent.cli}</span>
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
      <span className="text-[11px] text-muted-foreground" title="开启后该 agent 每次工具调用前请求授权（仅交互式会话生效）">安全</span>
      <Toggle
        on={agent.safeMode}
        onChange={() => onChange({ safeMode: !agent.safeMode })}
        title={agent.safeMode ? '安全模式：开（启动时请求授权）' : '安全模式：关（最高权限）'}
      />
      <Toggle
        on={agent.enabled}
        onChange={() => canDisable && onChange({ enabled: !agent.enabled })}
        disabled={!canDisable}
        title={!canDisable ? '至少保留一个启动 Agent' : agent.enabled ? '停用' : '启用'}
      />
    </div>
  )
```

(`updateAgent(cli, patch)` already merges partial patches into the entry and marks the agent form dirty, and `saveAgents` posts the whole `agentList` via `api.saveSettings({ agents: { list, ... } })` — so `safeMode` is saved with no further wiring.)

- [ ] **Step 2: Typecheck the web project**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: clean.

- [ ] **Step 3: Manually verify the round-trip**

Run: `npm start`, open Settings → 启动 Agents. For an agent, toggle 安全 on, click 保存, reload the page. Confirm the toggle is still on (persisted). Toggle off and save → back to default.

Then launch a fresh interactive session for that agent and confirm (e.g. via `ps`/the terminal) the bypass flag is absent — the CLI prompts for approval in the web terminal. Toggle off → next fresh launch runs at max permission again.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Settings.tsx
git commit -m "feat(web): per-agent safe-mode toggle in Settings"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test`
Expected: PASS (green). In particular `test/launch.test.ts`, `test/agent-config.test.ts`, `test/pty-ws.new.test.ts`.

- [ ] **Step 2: Typecheck both projects**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: both clean.

- [ ] **Step 3: Confirm untouched paths still inject bypass flags**

Run: `git grep -n "dangerously-skip-permissions\|--yolo\|dangerously-bypass-approvals-and-sandbox" src/pty/launch.ts src/agent/index.ts`
Expected: `freshArgvStream` (line ~148, 161), `codexTurnArgv` (~196), `cocoTurnArgv` (~201), and `src/agent/index.ts` (~59, ~75) still carry the unconditional bypass flags — only `freshArgv` is now conditional. This confirms Model B / per-turn / headless remain max permission per the spec.

---

## Notes / open verification item

During Task 5's manual verification, confirm **codex** launches cleanly in safe mode (dangerous flag dropped, `--profile` + `--dangerously-bypass-hook-trust` retained) — i.e. the profile/manifest still loads and codex falls back to prompting rather than erroring on a missing approval mode. If codex requires an explicit `--ask-for-approval` / `--sandbox` to start, add those (non-dangerous) flags to the codex safe-mode branch in `freshArgv` and update the Task 2 codex test accordingly.
