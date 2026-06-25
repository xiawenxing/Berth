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

Run (prod, one command): `npm run prod` (full build — vendor + esbuild core + `web build` — then
`berth start`), serving the 2.0 SPA at `/app` from a single process; root `/` 302-redirects to `/app`
(**1.0 entry is deprecated** — `public/` files stay served, e.g. `/index.html`, but nothing routes
there). Run (dev): `npm start` (vendors xterm+marked, then `tsx bin/berth-serve.ts`) is the **backend
only** → http://localhost:7777 (`PORT` overrides); pair with `cd web && npm run dev` for the
live-reloading SPA. `npm test` = unit; `*.live.test.ts` are gated behind `BERTH_LIVE=1`.

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
  `launch_intent`, `archived_project`, `project_path` (per-project home cwd + added 货舱 paths, each
  with an `enabled`/默认装载 flag), `session_import_dir` (legacy 无归属 dir-import root — kept for the
  old vanilla app), `session_import` (the **session-grained** import set — see below).
  **FK enforcement is deliberately OFF** (`pragma foreign_keys = OFF`) — see gotchas.
- `server/store-singleton.ts` — process-wide store + in-memory session cache; `refresh()` re-scans
  disk, **filters to the curated/imported set** then upserts, then runs codex reconcile **over the
  UNFILTERED scan** (a fresh codex session isn't in the filtered cache yet, so reconcile must see the
  full scan to bind it — see gotcha #14). `importRoots()` is now **only `session_import_dir`**
  (project paths + launch-intent cwds were dropped — registering a 货舱 cwd must not surface all its
  sessions). `curatedSessionIds()` = pin ∪ attach(real project) ∪ edge ∪ **`session_import`** ∪
  **`allBoundLaunchSessionIds()`** (Berth-launched sessions surface per-session). `berthAgentCwd()` is
  still excluded (internal title/summary sessions stay hidden, gotcha #7).

**Data layer (canonical; see "Data-source seam" below):**
- `data/tasks.ts` / `data/projects.ts` — internal task/project CRUD against sqlite (the guarded
  `createTask` keeps search-before-create → classify/explicit project → pasted-image → detail-md).
- `data/sync/feishu.ts` — Feishu bitable **adapter** (replaced the old `server/{todos,projects}.ts`):
  read via `+record-list`, write via `enqueueWrite`, field map + `obsidian://` translation from config.
- `bitable/writeQueue.ts` + `bitable/queue-singleton.ts` — **all bitable writes serialize here**
  (`enqueueWrite(key, exec)`); coalesces concurrent same-key writes (see gotchas). Used by the adapter.
- `agent/index.ts` — `runAgent` (headless one-shot; cli+model from the configured **berth agent**,
  default `claude -p` / haiku) + `generateTitle`. claude reads the reply from stdout; codex runs
  `codex exec -o <file>` and reads the final reply from that file (stdout has banner noise). Both go
  through `runHeadless` (spawn + streamed stderr): on failure it throws a typed `InternalAgentBlocked`
  (see `agent/agent-failure.ts`) classified `auth`/`timeout`/`other`, **killing early** the moment an
  auth signature shows in stderr instead of waiting the full timeout. `generateTitle`/
  `generateProgressSummary` do NOT retry an `auth` block. Endpoints map the typed error to
  `409 {blocked,cli,hint}` (`sendAgentError` in `api.ts`) so the UI shows an actionable "run
  `claude login` / `codex login`" message instead of a silent ~105s spinner (gotcha #7). The
  cli/model come from `data/agent-config.ts` (`resolveBerthAgent`), resolved at the call site
  (`api.ts`, `data/tasks.ts`) — the agent module stays pure.
- `agent/agent-failure.ts` — pure failure classifier (`classifyAgentFailure`/`looksLikeAuthBlock` +
  per-CLI auth signature tables), the `InternalAgentBlocked` error, and `agentBlockHint` (locale-aware
  actionable message). Signatures are best-effort — confirm against real CLI output.
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

**Frontend:** there are **two** trees. **`web/` is the active frontend (Berth 2.0)** — a built React
SPA (Vite + TypeScript + Tailwind; `web/src/`, design tokens/themes in `web/src/lib/theme.ts`). **All
new frontend work goes there.** **`public/{index.html,app.js,style.css}` is the FROZEN 1.0 UI**
(legacy vanilla JS, no build) — maintenance-paused; do not add features/UI changes to it (see
CLAUDE.md). Both are served by the same `src/` Node backend. The rest of this section documents the
frozen 1.0 tree for reference (xterm + marked vendored into `public/vendor/` by `npm run vendor`).
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
- A WebSocket is just a **view**. `attachViewer` replays the scrollback ring buffer / persisted spool
  tail (2MB in-memory; larger replay from disk), then streams; on socket close it **detaches only** —
  the pty keeps running.
- TUI raw bytes are also appended to Berth's own durable spool under
  `<BERTH_HOME>/pty-streams/*.ansi` (`server/pty-spool.ts`). Reattach replays a bounded tail from
  this spool (default 16MB, max 64MB) before streaming live output, so long-running sessions no
  longer depend only on the in-memory ring. This is a terminal-byte replay cache, not the CLI's JSONL
  conversation transcript.
- **Switching sessions / closing the view / reloading the tab does NOT stop the agent.** Reconnecting
  re-attaches to the same live process with full scrollback.
- A `{t:'kill'}` message (the **■** header button) actually kills; **×** just closes the view.
- The 8-terminal frontend pool now caps *views*, not running agents.
- `rekeyPty(oldKey,newKey)` moves a codex pty from its intent id to its real session id (reconcile).

**Remaining boundary:** PTYs are children of the Berth server process — if the server stops, they
stop. Surviving a server restart would need a detached daemon/tmux; not done.

Frontend side: `web/src/components/Terminal.tsx` opens `/pty`; reconnect is the default path
(clicking a session whose view was disposed just re-attaches server-side). In TUI mode, scrolling to
the top expands the requested `historyBytes` window and reconnects to replay a larger spool tail.
Because xterm raw ANSI state cannot be safely prepended from an arbitrary byte boundary, this is a
larger-tail replay rather than a seamless infinite-scroll prepend.

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

### Testing the first-install / init chain — `BERTH_HOME` (clean Berth data, real sessions)

`BERTH_HOME` (see `src/paths.ts`) relocates only Berth's OWN state — the sqlite db, docs-root default,
and first-run seed — to a directory you choose. It defaults to `~/.berth`, so production is untouched.
Pointing it at a fresh dir gives the **never-installed-Berth** state (empty db: no pins/attach/tasks/
imports) **while the CLI session stores (`~/.claude`, `~/.codex`, coco cache) stay on the real home** —
so the machine's real sessions are still scanned and offered for import. That is the actual first-run
a new Berth user hits on an existing machine, and it's the switch for polishing the init/onboarding
chain. (Binaries also resolve from the real home, so launching works normally.)

Recipe — the clean instance is **two processes** (the data isolation is all on the backend; Vite is
just a view that proxies to it). Defaults: backend `:7788`, Vite `:5174`, dir `/tmp/berth-clean`. So
it runs **alongside** your normal backend (`:7777`) + Vite (`:5173`) without colliding:

```bash
mkdir -p /tmp/berth-clean
npm run dev:clean                  # clean backend: PORT=7788 BERTH_HOME=/tmp/berth-clean
cd web && npm run dev:clean        # clean Vite: :5174, proxies /api+/pty+/status -> :7788
# open http://localhost:5174/app/  → fresh Berth; sidebar starts empty (nothing imported yet), but
#   the import dialog finds your real sessions; import / launch to exercise the onboarding flow
rm -rf /tmp/berth-clean            # reset to a pristine first-install state
```

Override any of `PORT` / `BERTH_HOME` (backend) or `BERTH_WEB_PORT` / `BERTH_API_PORT` (Vite, in
`web/vite.config.ts`) to pick other dirs/ports. Note: `:7777` is the **backend** (REST `/api` + WS
`/pty`/`/status`), shared by both the 1.0 `public/` UI and the 2.0 SPA — *not* a 1.0-only port; the
2.0 frontend you browse at `:5173` is the Vite dev server proxying to it.

### Session import — session-grained (as of 2026-06-17, spec `2026-06-17-project-cwd-cargo-session-import-design.md`)

A session surfaces iff it is in `curatedSessionIds()` (pin ∪ attach-to-real-project ∪ edge ∪
`session_import` ∪ bound-launch) **or** its `cwd` ∈ `session_import_dir` (legacy dir-import root,
kept for the old vanilla `public/` app). **Registering a 货舱 cwd (`project_path`) does NOT surface
its sessions** — only sessions explicitly added to `session_import` (via the import dialog) do. This
is the session-grained model that replaced the old directory-grained one (where `project_path` and
`launch_intent.cwd` were also import roots).

- **Berth-launched sessions** surface per-session via `allBoundLaunchSessionIds()` (claude/coco get a
  `bound=1` launch_intent at launch; codex binds via `reconcile.ts` then surfaces on the next refresh).
- **Project default workspace cwd**: a launch with no enabled 货舱 falls back to
  `~/.berth/workspaces/<projectId>/` (server-resolved in `pty-ws.handleFresh`, created on demand by
  `launch.ensureLaunchCwd`). The UI masks it as 「项目默认目录」 (never shows the raw path).
- **Sticky 主 cwd**: `app_setting` key `project_last_cwd:<id>` (written after a real-货舱 launch,
  cleared on project delete) drives the launch dialog's auto-pick; no `is_home` star in the new UI.
- **Migrations**: `migrate-session-dirs.ts` (legacy, `session-dirs-migrated`) backfilled
  `session_import_dir`. `migrate-session-import.ts` (`session-import-migrated`) seeds `session_import`
  with the OLD visible set (old roots ∪ old curated) so existing installs don't lose any visible
  session when `project_path`/`launch_intent` stop being roots.

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
   and uses a 20s timeout. Server start kicks off a background warm (`warmAgentBinaryCaches`) so the
   first page-launched coco session usually does not pay this on the click-to-spawn path. If a user
   launches coco before the warm finishes, that launch can still block on the identity check.
   `binaries.test.ts` can still flake when coco is cold — re-run; it's not a real regression.
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
7. **The management agent (`claude -p` for titles/summaries) writes its own session jsonl** into
   `~/.berth/agent-cwd`. These are **hidden** from the session list: `berthAgentCwd()` is deliberately
   NOT an import root (`store-singleton.importRoots`). They are headless one-shots that never block and
   never need user action, so surfacing them in 无归属 was pure noise. (Earlier the owner kept them
   visible as a "Berth activity" log; that choice was reversed.)
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
14. **`refresh()` feeds `reconcileLaunchIntents` the UNFILTERED scan, not the cache.** A fresh codex
    launch is `bound=0` / unattached / not in `session_import`, and its cwd is not an import root — so
    it is filtered OUT of the cache. If reconcile got the cache it could never find the session →
    never `bindIntent` → never surface (permanent deadlock). reconcile constrains candidates by intent
    cwd/cli/time internally, so the wider input is safe. Same trap applies if you ever re-narrow the
    surfacing filter: re-check that the codex bind path still sees the session.

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
