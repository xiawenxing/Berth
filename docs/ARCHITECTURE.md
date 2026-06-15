# Berth — Architecture & Handoff

> High-signal map of the codebase for an agent/engineer picking this up cold. Read this before
> changing the launch/terminal path, the sync write path, or the data model.

## What Berth is

A **local, single-user web app** (Node server + browser UI) that is a cockpit over all your CLI agent
sessions (Claude Code / Codex / Coco-TraeCLI) **plus** a local task/project manager. It reads each
CLI's session store read-only, launches/resumes sessions in embedded terminals, and ties sessions to
projects/tasks. Tasks and projects are canonical in Berth's own SQLite store and can optionally
two-way-sync to an external system (e.g. a Feishu base) via a pluggable adapter.

> **On the current "no bundler / vanilla frontend": this is a demo-stage shortcut, NOT a design
> principle.** Earlier docs framed zero-build as Berth's identity — that framing is wrong. The
> target architecture is a **mature frontend/backend split with a real build pipeline** (React +
> a shadcn-style component library); the vanilla `<script>`-tag frontend is interim and will be
> migrated. Don't enshrine "no build" as a constraint — tech choices serve the product, and the
> roadmap (kanban DnD, rich-text comments, realtime timelines, multi-client) needs a built SPA.
> See **Roadmap** at the bottom.

Stack: Node 20, TypeScript ESM, `express` + `ws`, `node-pty`, `better-sqlite3`, `@xterm/xterm`,
`marked`. Tests: `vitest`. macOS-only in places (native folder dialog via `osascript`).

Run: `npm start` (vendors xterm+marked, then `tsx bin/berth-serve.ts`) → http://localhost:7777
(`PORT` env overrides). `npm test` = unit; `*.live.test.ts` are gated behind `BERTH_LIVE=1`.

---

## Module map (`src/`)

**Session ingestion (read-only):**
- `adapters/{claude,codex,coco}.ts` — enumerate each CLI's on-disk sessions, read real cwd + a
  human title from the jsonl body.
- `dedup/identity.ts` — merge the three sources into canonical `LogicalSession`s via the Codex import
  ledger (the only reliable join key); collapse subagents; directional content guard.
- `sessions.ts` — `collectLogicalSessions(roots)` ties adapters + dedup together, and
  `filterImportedSessions(sessions, roots, curatedIds)` restricts the universe to **imported
  directories** (see "Session import directories" below) — sessions are NOT seeded by scanning every
  CLI session anymore.

**Local state (the app's own DB, `~/.berth/berth.sqlite`):**
- `db/store.ts` — `openStore(path)`. Tables: `logical_session`, `physical_copy`, `attach`
  (session→project + confirm state), `pin`, `title_override`, `edge` (task↔session, a SET),
  `launch_intent`, `archived_project`, `project_path` (per-project home cwd + added paths),
  `session_import_dir` (the 无归属 import roots — see below).
  **FK enforcement is deliberately OFF** (`pragma foreign_keys = OFF`) — see gotchas.
- `server/store-singleton.ts` — process-wide store + in-memory session cache; `refresh()` re-scans
  disk, **filters to imported directories** (`importRoots()` = `session_import_dir` ∪ project paths ∪
  launch-intent cwds; `curatedSessionIds()` is the attach/edge/pin safety net), upserts, then runs
  codex reconcile.

**Data layer (canonical; see "Data-source seam" below):**
- `data/tasks.ts` / `data/projects.ts` — internal task/project CRUD against sqlite (the guarded
  `createTask` keeps search-before-create → classify/explicit project → pasted-image → detail-md).
- `data/sync/feishu.ts` — Feishu bitable **adapter** (replaced the old `server/{todos,projects}.ts`):
  read via `+record-list`, write via `enqueueWrite`, field map + `obsidian://` translation from config.
- `bitable/writeQueue.ts` + `bitable/queue-singleton.ts` — **all bitable writes serialize here**
  (`enqueueWrite(key, exec)`); coalesces concurrent same-key writes (see gotchas). Used by the adapter.
- `agent/index.ts` — `runAgent` (headless one-shot; cli+model from the configured **berth agent**,
  default `claude -p` / haiku) + `generateTitle`. claude reads the reply from stdout; codex runs
  `codex exec -o <file>` and reads the final reply from that file (stdout has banner noise). The
  cli/model come from `data/agent-config.ts` (`resolveBerthAgent`), resolved at the call site
  (`api.ts`, `data/tasks.ts`) — the agent module stays pure.
- `data/agent-config.ts` — user-configurable launch agents (per-CLI enable + default model) and the
  berth management agent (cli+model), in `app_setting`. `HEADLESS_CLIS`=['claude','codex'] (CLIs that
  can be the management agent — claude via `claude -p`, codex via `codex exec -o <file>`; coco has no
  headless one-shot); `MODEL_FLAG_CLIS`=['claude','codex'] (coco has no `--model`). An empty
  `berthAgentModel` means "the CLI's own default". Mirrors `task-config.ts`.
- `agent/triage.ts` — `classifyProject(text, names)` → ranked project candidates.
- `agent/transcript.ts` — strip injected hook/system/command noise before titling.
- `agent/manifest.ts` — A1 non-LLM context index built at launch (task progress / detail-md path,
  or project md list) + `--add-dir` targets. `obsidianLinkToPath`.
- `data/docstore.ts` — `DocStore` for md context docs + image attachments under a **configurable**
  `docsRoot` (default `~/.berth/docs`, may point at the vault), with the path-traversal guard
  (`resolveDocPath`/`resolveAssetPath` confine to the root). Replaced the hardcoded `server/docs.ts`.
- `data/context-{log,config,protocol,doc}.ts` — 上下文管理规范（AGENTMD）Phase 1：`context-log.rotateLog`
  是纯函数滚动进展日志；`context-config` 三项 app_setting（`contextLogMaxLines`/`contextLogKeep`/
  `contextProtocolEnabled`）；`context-protocol` seed/解析生效 `AGENTS.md`（全局 + per-project 覆盖）→
  `compactRules` + 路径；`context-doc` 按模板惰性建 `tasks/<id>/index.md`·`projects/<name>/index.md` +
  `rotateContextDocOnDisk` 磁盘滚动封装。启动时 `pty-ws.handleFresh` seed 协议 + `ensureContextDoc` +
  经 `manifest` 静默通道注入精简规则/路径；会话 PTY 退出触发 `registerPty` 的 `onExit` → 机械滚动。
  规则文案/模板在 `i18n.contextStrings`（zh-CN/en）。`POST /api/context` 惰性建上下文文件。
- `data/context-apply.ts` + `agent/context-consolidate.ts` + `server/context-consolidate-service.ts` —
  上下文管理 Phase 2（整合兜底）：`consolidateContext` 复用 `runAgent` 读 transcript + 当前上下文，
  让无头 agent **只产结构化 `{progress,status}` JSON**（不直接改文件，稳定段安全）；纯函数
  `context-apply.applyConsolidation` 确定性写回（追加「进展日志」+ 覆盖「当前状态」节）再跑 Phase 1 滚动。
  编排在 `context-consolidate-service.runConsolidation`（会话→task/project 上下文映射 + 读 transcript）。
  触发：`POST /api/sessions/:id/consolidate`（前端会话行的「刷新上下文」⟳ 按钮）。

**Launch / terminal (the core):**
- `pty/binaries.ts` — `resolveAgentBinary` (pins coco at `~/.local/bin/coco`, blacklists the Trae IDE
  launcher, `verifyCoco` identity check — **cached**, see gotchas).
- `pty/launch.ts` — `resumeArgv`/`resumeSession` and `freshArgv`/`launchFresh`. Fresh launches add
  **bypass-permissions** flags; only task/execution launches submit a positional first prompt.
  claude/coco pre-mint `--session-id`. The manifest rides a silent channel per CLI (see gotcha #12).
- `pty/coco-hook.ts` — `ensureCocoBerthHook()` registers coco's silent `session_start` context hook
  in `~/.trae/traecli.yaml` (idempotent, no-clobber); `writeCocoContextPayload()` pre-encodes the
  manifest as the hook's JSON-envelope stdout.
- `server/pty-registry.ts` — **persistent PTY registry** (see next section). The heart of the model.
- `server/pty-ws.ts` — the `/pty` WebSocket endpoint: resume attaches to a live pty (or spawns),
  fresh launches plan + record attribution + spawn + register. `planFreshLaunch` is pure/tested.
- `server/reconcile.ts` — binds pending codex launch-intents to their real session id on refresh and
  **rekeys the live pty** so a later click reattaches instead of spawning a parallel resume.

**Wiring:** `server/index.ts` (express + ws, JSON limit 30mb for pasted images), `server/api.ts`
(all REST routes), `bin/berth-serve.ts` (entry).

**Frontend:** `public/{index.html,app.js,style.css}` — currently vanilla JS with no build step (a
demo-stage choice, see "What Berth is" / Roadmap — the target is a built React SPA). xterm +
marked vendored into `public/vendor/` by `npm run vendor`.
- **Design system (shadcn-style, vanilla):** `public/tokens.css` (oklch neutral palette, dual theme —
  dark is default `:root`, light is `html.light`; radius/shadow/type vars; legacy `--bg/--text/--accent…`
  aliased onto semantic tokens) + `public/components.css` (hand-written `.btn/.card/.badge/.input/.dialog/
  .tabs/.tooltip/.separator` classes). `style.css` consumes tokens (no hardcoded theme hex left except
  `#000/#fff` overlays). Loaded in order: tokens → components → style. Theme is set pre-paint by an inline
  script in `index.html` (localStorage `berth-theme`, or `?theme=light|dark` deep-link); toggled via the
  nav sun/moon button (`setTheme`/`toggleTheme` in app.js). Theme is a preference, not routing state.
- **Icons:** lucide via a vendored SVG `<symbol>` sprite at `public/vendor/lucide.svg`, generated by
  `scripts/build-lucide-sprite.mjs` (runs in `npm run vendor`) from a whitelist of the icons actually used.
  Use the `icon(name)` helper in app.js → `<svg class="icon"><use href="/vendor/lucide.svg#name"></use></svg>`.
  Add an icon: extend the whitelist in the build script, re-run vendor.

---

## The persistent-PTY model (most important architecture)

Agents run in **server-side PTYs that are decoupled from any browser socket** (the tmux model). This
replaced an earlier design where the agent process was tied 1:1 to its WebSocket and got killed on
view-switch / pool-eviction / tab-close.

`server/pty-registry.ts` keeps a `Map<sessionId, {pty, ring-buffer, viewers}>`:
- A WebSocket is just a **view**. `attachViewer` replays the scrollback ring buffer (~512KB) then
  streams; on socket close it **detaches only** — the pty keeps running.
- **Switching sessions / closing the view / reloading the tab does NOT stop the agent.** Reconnecting
  re-attaches to the same live process with full scrollback.
- A `{t:'kill'}` message (the **■** header button) actually kills; **×** just closes the view.
- The 8-terminal frontend pool now caps *views*, not running agents.
- `rekeyPty(oldKey,newKey)` moves a codex pty from its intent id to its real session id (reconcile).

**Remaining boundary:** PTYs are children of the Berth server process — if the server stops, they
stop. Surviving a server restart would need a detached daemon/tmux; not done.

Frontend side: `public/app.js` `connectFreshWs`/`connectWsForEntry` open the WS; reconnect is the
default path (clicking a session whose view was disposed just re-attaches server-side).

---

## Data model & where state lives

> **As of 2026-06-15 the data layer is decoupled** (branch `feat/data-source-decoupling`). Berth's
> sqlite is now the **canonical** store for tasks/projects; external systems (Feishu bitable now,
> Meego stubbed) are **pluggable sync adapters** behind a seam. See "Data-source seam" below.

| Thing | Source of truth | Notes |
|---|---|---|
| Sessions | each CLI's jsonl store | read-only; merged to `LogicalSession` |
| Tasks / projects | **Berth sqlite** (`task`, `project`) | canonical; synced to/from adapters |
| Task/project detail docs + images | **Berth docstore** (configurable `docsRoot`) | md owned by Berth; default `~/.berth/docs`, may point at the vault |
| External record ids (feishu recordId, …) | `external_ref` (local) | maps `task.id` ⇄ per-source external id |
| pin / attach / edge / title-override / archived / **project home cwd** / **session import dirs** / **task ddl** | **Berth sqlite (local)** | per-machine; `task_ddl` is a local-only (not synced) deadline overlay keyed by `task.id` |
| Live agent processes | **`pty-registry` (in-memory)** | gone on server restart |

A **task** has a Berth-native uuid `id`; `recordId` no longer exists in the core (it lives only in
`external_ref.external_id`). A **task↔session link** (`edge.todo_key`) holds a `task.id`. A **session→
project** link is `attach`. **Projects keep name as their key** (in `attach`/`project_path`/
`archived_project`/`task.project`).

### Session import directories (会话导入目录)

The session list is **not** seeded by scanning every CLI session anymore. It is seeded by importing
directories (like 新建项目's cwd): the scanned universe is sessions whose `cwd` is under an **import
root**, computed in `store-singleton.importRoots()` as `session_import_dir` ∪ all `project_path.cwd`
∪ all `launch_intent.cwd`. So a new project auto-surfaces its sessions, and any Berth-launched session
surfaces via its launch-intent cwd, without a separate import step. A **safety net**
(`curatedSessionIds()`) always keeps attached/edged/pinned sessions regardless of cwd. The match is
**exact** (a session's cwd must equal an import root — importing a directory does NOT recursively pull
in its subdirectory tree; import a subdirectory explicitly to include it); null-cwd sessions are kept
only via the safety net. `migrate-session-dirs.ts` runs once (guarded by the
`session-dirs-migrated` setting) to backfill `session_import_dir` from already-attached sessions, so
existing installs don't empty out; fresh installs start empty and prompt the user to import a dir.

### Data-source seam (切面)

- `src/data/` owns the canonical layer: `types.ts`, `store-data.ts` (the new sqlite tables +
  methods, spread into `openStore`), `tasks.ts`/`projects.ts` (domain CRUD + the ported create
  guardrails), `docstore.ts` (configurable-root md/asset filesystem), `bootstrap.ts` (first-run seed),
  `migrate.ts` (one-time recordId→uuid identity migration).
- `src/data/sync/`: `adapter.ts` (the `DataSourceAdapter` interface), `registry.ts` (kind→adapter),
  `feishu.ts` (the only code that knows lark-cli / recordId / Chinese field names / `obsidian://`),
  `meego.ts` (stub), `engine.ts` (`syncSource` pull/push + conflict detection; `resolveConflict`),
  `hash.ts` (shared field hash so push/pull round-trip cleanly).
- **Sync is manual by default** (per-source `pull_mode`/`push_mode`). `POST /api/sync` pushes local
  edits + pulls external changes; when both sides changed a `sync_conflict` is recorded and surfaced
  for the user to resolve (`/api/conflicts`, `/api/conflicts/:id/resolve`) — never auto-merged.
- **No personal config in code.** Feishu base/table/field ids + field map + `docsRoot` come from
  `data_source.config_json` / `app_setting`, configured in the Settings UI. First run seeds them from a
  **local untracked** `~/.berth/seed.json` (or `BERTH_SEED_JSON`); fresh installs start empty.

---

## API surface (`server/api.ts`)

- `GET /api/sessions` → sessions enriched with `pinned/projectId/attachState/todoKey`.
- `POST /api/refresh` → re-scan disk, **scoped to imported directories** (call this after a fresh
  launch so the new jsonl is picked up). Exposed in the UI as the 会话列表页 **同步会话** button.
- `GET/POST/DELETE /api/session-dirs` → list/add/remove the 无归属 session-import roots (`{cwd}`);
  add/remove re-scan and return the new session `count`. The 无归属 section's **导入目录** button.
- `POST /api/pin`, `POST /api/attach` (session→project), `POST /api/edge` (session→task).
- `GET /api/projects` → projects + `archived/homeCwd/paths`. `POST /api/projects/{archive,create,add-path}`.
- `GET /api/todos` → tasks (`id` is a Berth uuid) + `sessions[]`. `POST /api/todos` (create; accepts
  `images[]` base64 + `projectId/confirm/createOption`). `PATCH/DELETE /api/todos/:id` by `task.id`.
- `POST /api/sync` (push local edits + pull external; returns `conflicts`). `?direction=pull|push`
  restricts to one side (omitted = both); surfaced as the project-workspace **Pull** / **Push**
  buttons. `GET /api/conflicts`,
  `POST /api/conflicts/:id/resolve` (`{side:'berth'|'external'}`). Data sources:
  `GET/POST /api/data-sources`, `DELETE /api/data-sources/:id`. Settings: `GET/POST /api/settings`
  (`docsRoot`, task status/priority vocab, **`agents`** — per-CLI enable/model + the berth
  management agent's cli/model; see `src/data/agent-config.ts`).
- `POST /api/sessions/:id/title` (AI title), `POST /api/pick-folder` (native macOS folder dialog).
- `GET /api/doc` / `POST /api/doc` (read/write a vault md, mtime-conflict-guarded) /
  `GET /api/doc-asset` (serve a vault image). All confined to `projects/`.
- `WS /pty?...` — `new=1` fresh launch (cli/cwd/todoKey/projectId/prompt) or resume (sessionId).
  On a fresh launch the server's **first frame** is a control frame
  `{"__berth":"launched","sessionId":…,"bound":…}` (precedes all pty output) telling the client which
  real session id the launch maps to, so the UI can associate its "创建中…" placeholder row with the
  real session. All other frames are raw pty bytes; the client treats only frames starting with
  `{"__berth"` as control.

---

## Gotchas / landmines (these cost real debugging time)

1. **bitable 详情文档 is markdown-wrapped**, not a bare link:
   `[obsidian://...&file=projects%2Fx](http://obsidian://...)`. Extract the `file=` param from
   *anywhere* in the string (`resolveDocPath` does). Assuming it starts with `obsidian://` breaks it.
2. **`coco --help` is slow + flaky** (4–15s; does a network/update check). `verifyCoco` caches success
   and uses a 20s timeout. `binaries.test.ts` can still flake when coco is cold — re-run; it's not a
   real regression. Every coco resume/launch pays this once per server run.
3. **better-sqlite3 enforces foreign keys by default.** `openStore` sets `pragma foreign_keys = OFF`
   so attach/edge can reference a freshly-launched session id **before** the next refresh ingests it
   (soft FKs). Don't turn this back on.
4. **All bitable writes MUST go through `enqueueWrite`** (serial, ≥800ms spacing). Concurrent same-key
   writes are coalesced to one result; the queue is fed a *unique* key internally so a job is never
   silently dropped (an earlier bug hung the HTTP request forever). Also: **search-before-create**
   and **never auto-create a 项目领域 option** (only on explicit `createOption:true`).
5. **Fresh launches run in bypass-permissions mode**: claude `--dangerously-skip-permissions`,
   coco `--yolo`, codex `--dangerously-bypass-approvals-and-sandbox`. Berth-launched sessions are
   unattended by design.
6. **claude/coco `--session-id <uuid>` creates a session at exactly that id** → deterministic capture.
   codex has no `--session-id` → bound later by `reconcile.ts` (newest codex session in that cwd after
   launch time). Verified empirically.
7. **The management agent (`claude -p` for titles) writes its own session jsonl** into Berth's cwd
   group — the owner chose to keep these visible as a "Berth activity" log rather than hide them.
8. **lark-cli envelope shapes:** `+record-search`/`+record-list` return column arrays
   (`data.fields` / `data.data` / `data.record_id_list`), NOT `items[].fields`. `+record-batch-create`
   returns `data.record_id_list`. Field options use `hue`/`lightness`.
9. **Routing is URL-hash based** (`#/now`, `#/project/<name>`, `#/sessions/<id>`) — the source of
   truth, so reload/back/forward work and a focused session re-attaches on load. Not localStorage.
10. **Vendored libs** (`xterm`, `marked`) are copied to `public/vendor/` by `npm run vendor` (runs in
    `npm start`); the same step generates `public/vendor/lucide.svg` (icon sprite) via
    `scripts/build-lucide-sprite.mjs`. The frontend is currently plain `<script>` tags (interim —
    see Roadmap). Vendored artifacts are committed (tracked), so a fresh checkout renders without
    running vendor first.
11. **claude's workspace-trust dialog blocks unattended launches.** Interactive claude (a PTY *is* a
    TTY) shows "Is this a project you trust?" for any folder not yet marked trusted; `--dangerously-
    skip-permissions` does **not** clear it (it's only auto-skipped in `-p`/non-TTY mode). Unanswered,
    it swallows the auto-submitted task directive → no turn → no transcript → the session never
    surfaces in the list. `pty/trust.ts` `ensureClaudeTrust(cwd)` pre-seeds
    `~/.claude.json` → `projects[realpath(cwd)].hasTrustDialogAccepted = true` before every claude
    spawn (fresh + resume). **Keyed by the resolved real path** (`/tmp`→`/private/tmp` on macOS), else
    it won't match. coco/codex use different configs and are **not** covered yet.
12. **Context is not always a user prompt.** Task launches should auto-submit a first turn, but
    taskless/project "new session" launches must stay idle; do **not** submit the manifest alone as a
    visible user message. **All three CLIs now receive the manifest through a silent channel** — the
    positional prompt only ever carries the user's real first message:
    - **claude** — `--append-system-prompt-file <inject>`.
    - **codex** — Berth's generated `~/.codex/berth-launch.config.toml` `SessionStart` hook +
      `BERTH_CONTEXT_FILE` + `--dangerously-bypass-hook-trust` (the hook `cat`s raw text).
    - **coco** — a `session_start` hook in `~/.trae/traecli.yaml` whose `hookSpecificOutput.
      additionalContext` coco injects as a `<system-reminder>` (confirmed in `coco doc hooks`).
      `pty/coco-hook.ts` `ensureCocoBerthHook()` idempotently merges that hook into the owner's global
      coco config (preserving Flux Island etc.; refuses to write if the file won't parse), keyed on
      `$BERTH_CONTEXT_FILE` so it no-ops for hand-started coco sessions. coco treats non-JSON hook
      stdout as empty, so `writeCocoContextPayload()` pre-encodes the manifest as the JSON envelope and
      the hook only `cat`s it (no jq/python needed in the hook's `sh -c` env). coco has **no
      `--profile`/`TRAE_HOME` isolation** (verified), so this is a shared-config mutation rather than a
      throwaway profile file like codex.
    > Historical note: coco used to bundle `manifest + task directive` into the positional prompt
    > because no silent channel was confirmed at the time — that assumption was wrong; coco's hook
    > system supports it.
13. **`--add-dir <directories...>` is VARIADIC — it eats the positional prompt.** `freshArgv` must fence
    any positional prompt behind `--` (`… --add-dir <vault> -- <prompt>`) so option parsing stops
    before the prompt. Don't put the prompt directly after `--add-dir`.

---

## Tests

`npm test` runs unit tests (mock the lark-cli/spawn boundary). Notable: `pty-registry.test.ts`
(persistence/reattach/kill/rekey), `store.test.ts` (soft-FK, edges, launch_intent, project_path),
`docs.test.ts` (path-traversal guard + the wrapped-link case), `queue-singleton.test.ts`
(no-hang coalescing), `launch.test.ts` (per-CLI argv incl. bypass flags), `reconcile.test.ts`,
`triage.test.ts`, `manifest.test.ts`, `api.test.ts`. ~125 passing.

`*.live.test.ts` (binaries cold-spawn, integration, pty/launch live) are gated behind `BERTH_LIVE=1`.

---

## Roadmap — frontend/backend modernization (direction, not yet built)

The current single-process, no-build, vanilla-`<script>` frontend is a **demo-stage shortcut**. The
agreed direction is a **mature frontend/backend split with a real build pipeline**:

- **Built SPA frontend** (React + a shadcn-style component library) replacing the hand-written
  `app.js`/`style.css`. The interim work already landed the **design-system foundation** that carries
  over: `public/tokens.css` is the oklch dual-theme token set (the same shape as a Tailwind v4
  `@theme` / shadcn `globals.css`), and the component/icon decisions in `components.css` + the lucide
  sprite map onto real shadcn components + `lucide-react`. So the migration replaces the *rendering
  layer*, not the *design language*.
- **Frontend/backend split:** the Node server becomes a typed API (REST + WS) consumed by the SPA,
  instead of serving static files it also renders against. The load-bearing constraint to preserve is
  the **persistent-PTY model** (see above) and the `/pty` WebSocket bridge into xterm — the migration
  must keep agents decoupled from any single browser socket.
- This is its own project (own spec → plan → phased implementation), tracked separately in the
  owner's personal-todo. Do **not** treat "no build" as a constraint when working on Berth.

---

## Design history

Earlier design specs, phase plans, and spike notes are kept outside this repository as working
notes; the implementation has since moved well past them. This document plus `DEVELOPMENT.md` are the
current source of truth for the architecture.
