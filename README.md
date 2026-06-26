<div align="center">

# ⚓ Berth

### _The cockpit for AI-driven work._

**Organize every agent session around your projects and tasks — and drive them to done.**

[![npm](https://img.shields.io/npm/v/@corusco/berth?color=2563eb&label=npm)](https://www.npmjs.com/package/@corusco/berth)
[![node](https://img.shields.io/badge/node-%E2%89%A520-43853d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-ISC-blue)](#license)
[![platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-lightgrey)]()

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

<!-- Drop a screenshot/gif here for the project page:
<p align="center"><img src="docs/assets/cockpit.png" width="820" alt="Berth cockpit" /></p>
-->

---

## What is Berth?

You don't run one AI agent anymore — you run **dozens**, across Claude Code, Codex, and Coco, scattered
over every repo on your machine. The work they do is real, but it lives nowhere: a wall of terminal
tabs with no memory of _which project_, _which task_, or _what's left to finish_.

**Berth is the cockpit that puts your projects and tasks in the driver's seat.** It's a local,
single-user web app that does two things at once:

- **A task manager built for AI** — projects, a tasks-by-status board, and per-task context docs,
  all owned locally. Tasks aren't just notes; each one can **launch an agent**, hand it the project's
  context, and **track it to completion**.
- **A session cockpit over every CLI agent** — one sidebar over all your Claude / Codex / Coco
  sessions. Search, pin, group by project or working directory, and click any session to **resume it
  live in an embedded terminal** — right in the browser.

The unit of organization is **the project and the task**, not the terminal tab. Berth reads each CLI's
own session store **read-only** and never moves or mutates your sessions — it just gives the people and
projects behind them a place to live.

```
   Project  ──▶  Task  ──▶  Launch  ──▶  Agent session  ──▶  Done
   (home cwd     (status,    (project      (Claude / Codex /     (progress
    + docs)       priority,   context       Coco, live in an      synced back
                  detail md)  injected)     embedded terminal,    to the board)
                                            survives reloads)
```

> **The core needs no accounts, no cloud, and no external integrations** — just the agent CLIs you
> already use. Your tasks, projects, pins, groupings, and docs all stay on your machine.

---

## Highlights

| | |
|---|---|
| 🗂️ **Project cockpit** | Each project has a home directory, a tasks-by-status board, markdown context docs (edit + live preview), and its own sessions — all in one workspace. |
| ✅ **AI-native task board** | Kanban tasks with configurable statuses & priorities. A task carries its own detail doc and can drive an agent that executes it. |
| 🚀 **Launch & drive agents** | Type a prompt, pick an agent / cwd / project → Berth spawns a fresh CLI session with the project's context **injected**, attributed to that task. |
| 🖥️ **Live embedded terminals** | Click any session to resume it in-browser. Agents **keep running in the background** when you switch away or reload — persistent server-side PTYs replay full scrollback on reconnect. |
| 🔎 **Unified session list** | One deduplicated list across Claude Code / Codex / Coco. Search, **pin**, group by project or working directory, drag a session onto a task to assign it. |
| 🔒 **Local-first & read-only** | Tasks/projects in a local SQLite db; docs as plain markdown. Berth reads CLI session stores read-only — it never mutates them. |
| 🔌 **Pluggable data sources** | Optionally two-way sync your task board to an external system (e.g. a Feishu base). Strictly opt-in; hidden when its tooling isn't installed. |

---

## Quick start

```bash
npx @corusco/berth@latest start   # → builds nothing, just runs; opens the UI at /app
```

That's the fastest path for **using** Berth. Berth is a **local server + browser UI** that comes in
several forms over one shared core — pick the one that fits:

| Form | Use it when | Get started |
|---|---|---|
| **CLI** (`berth start`) | running it as a tool | `npm install -g @corusco/berth` → `berth start` |
| **Desktop app** (Electron) | you want a double-click app | `npm run electron:dev` |
| **From source (prod)** | a one-command full build + run | `npm install && npm run prod` |
| **From source (dev)** | hacking on Berth itself | `npm install && npm start` (backend) + `cd web && npm run dev` (SPA) |

> The UI is the **React SPA at `/app`** — `berth start` and the desktop app open it directly, and the
> server redirects `/` → `/app`. `npm run prod` is the **single command** that builds the SPA + core
> and serves the whole thing from one process. Plain `npm start` is the **dev backend only** (no SPA
> build) — pair it with `cd web && npm run dev` for the live-reloading frontend.

All three share the same state under **`~/.berth`** — so **don't run two at once** (they'd contend on
the same SQLite db).

<details>
<summary><b>CLI — <code>berth start</code></b></summary>

```bash
npm install -g @corusco/berth
berth start                       # boots the server on loopback + opens the UI
```

Options: `berth start --port <n> --host <h> --no-open`, plus `berth --help` / `berth --version`.

> The server binds **`127.0.0.1` only** (single-user, unauthenticated). `--host 0.0.0.0` exposes it
> on your LAN — **unsafe**, since launching a session runs a CLI with bypass-permission flags.

</details>

<details>
<summary><b>Tasks & projects from any agent — <code>berth skill install</code></b></summary>

Berth is the canonical store for your tasks/projects (external systems like a Feishu base are just
optional sync sources). Manage them from the terminal with `berth task` / `berth project`, and — the
recommended way — **install the bundled skill so any AI agent can drive Berth for you**:

```bash
berth skill install               # install the berth-tasks skill into every agent you have
berth start                       # the task commands talk to a running server
```

`berth skill install` runs the cross-agent installer (`npx skills add`), so the **same skill** lands in
**Claude Code, Codex, Coco, Cursor, Gemini, Copilot, …** — each reads it from its own
`~/.<agent>/skills/`. (If that can't run, it falls back to symlinking the skill into the agent dirs you
have.) After that, just tell your agent *"新增待办 / 处理任务 / 查看待办"* and it drives Berth.

Don't have the `berth` package? Install **just the skill straight from GitHub** — no account, no Feishu,
works with any [`skills`](https://www.npmjs.com/package/skills)-supported agent:

```bash
npx skills add xiawenxing/Berth   # clones the public repo, installs skills/berth-tasks into all your agents
```

```bash
berth task add "<text>" [--project P]      # AI-classifies the project if omitted
berth task list [--status S] [--project P] [--json]
berth task done <id|title>                 # also: status / set / progress / rm
berth task sync                            # push local edits + pull external changes
berth project list | berth project add <name>
```

> The `berth task`/`project` commands need a running server (`berth start`); they'll tell you exactly
> how to start it (incl. the right `--port`) if it isn't up.

</details>

<details>
<summary><b>Desktop app — Electron</b></summary>

```bash
npm run electron:dev              # build + launch the app (rebuilds natives in-tree)
npm run electron:release          # OR: produce an installer in release/ (.dmg on macOS)
```

> **Cross-platform builds:** `electron:release` builds installers for the host OS — a `.dmg`/`.zip` on
> macOS, the `nsis` `.exe` on Windows. Building the **Windows** installer **from macOS** needs
> wine/mono; in practice build it on a Windows machine or a CI runner per target OS.

> **Native-ABI gotcha:** `electron:dev` rebuilds native addons (`better-sqlite3`, `node-pty`) **in-tree**
> for Electron, which breaks `npm test` / `npm start` until you restore them with `npm run rebuild:node`.
> `electron:release` builds in a throwaway worktree, so your dev tree stays intact.
>
> _Status: scaffolded; the `.dmg` build hasn't been verified yet (needs a Mac with a display)._

</details>

### Prerequisites

- **Node 20+.**
- At least one supported agent CLI on your `PATH`:
  [`claude`](https://docs.claude.com/en/docs/claude-code), `codex`, or `coco`. Berth is a cockpit over
  these — it doesn't bundle them.
- **Native deps:** `node-pty` and `better-sqlite3` are native modules (prebuilt for macOS/Windows). On
  **Linux** there's no `node-pty` prebuild, so `npm install` compiles from source — install
  `python3`, `make`, and a C++ compiler (`build-essential` / `gcc-c++`) first.

### Platform support

- **macOS** — primary, fully tested.
- **Linux / Windows** — in progress. Browser mode is designed to work here; some cross-platform
  hardening (binary discovery, a non-macOS folder picker, Windows path handling) is still landing.

---

## How it works

### 1. Import your sessions
The session list **starts empty** — Berth doesn't scan every CLI session on disk. Instead you
**import directories**, the same way you'd give a project a working directory:

- In the **无归属 (Unassigned)** section, click **导入目录 (Import directory)** and pick a folder. Berth
  pulls in the sessions whose working directory **is** that folder (not its subdirectories — import a
  subdirectory separately). Creating a project with a cwd imports its sessions automatically too.
- The **同步会话 (Sync sessions)** button re-scans imported directories to pick up new sessions.

### 2. Set up a project
Create a project with a home directory. It gets a tasks board, a markdown docs space (edit + live
preview in-app), and surfaces all the sessions under its directory.

### 3. Drive tasks with agents
Add a task to the board (status, priority, a detail doc). When you're ready, **launch** it: Berth
spawns a fresh agent session in the chosen CLI with the project/task **context injected**, attributed
to that task. The agent runs in an **embedded terminal** that keeps going in the background — switch
away, reload, come back, and reconnect to the same live process with full scrollback.

### 4. Track it to done
Move the task across the board as the agent works. Tasks, docs, and groupings all live locally; no
external service required.

---

## Concepts

| Concept | What it is |
|---|---|
| **Project** | A unit of work with a home directory, a tasks board, context docs, and attached sessions. |
| **Task** | A board card with a status, priority, and its own detail doc — and the thing that can **launch and drive an agent**. |
| **Session** | A CLI agent run (Claude / Codex / Coco), surfaced read-only and resumable live in an embedded terminal. |
| **Cockpit** | The unified workspace tying projects, tasks, and sessions together. |
| **Data source** | An optional plugin that two-way-syncs your task board with an external system. |

---

## Optional integrations (plugins)

Berth can sync its tasks to/from an external system via a pluggable data-source adapter. **These are
strictly optional** — Berth hides any integration whose required tooling isn't installed, and the
core works without them. All connection parameters live in local config, never in code.

- **Feishu (Lark) base** — two-way task sync to a Feishu base. Requires an internal `lark-cli` tool on
  your `PATH`; if it's absent, the integration is disabled and the rest of Berth is unaffected. Detail-doc
  links can optionally be written as `obsidian://` URLs into your own vault. Configure under
  **Settings → 数据源 (Data sources)**.
- **Meego** — stubbed adapter, not yet implemented.

> First-run connection config can be seeded from a **local, untracked** `~/.berth/seed.json` (or the
> `BERTH_SEED_JSON` env var). Fresh installs start empty and configure sources via the Settings UI.

---

## Data & isolated testing

Berth's own state — SQLite db, docs, first-run seed, launch manifests — lives under **`~/.berth`**.
To run without touching your real data (e.g. to simulate an empty first run), point `BERTH_HOME` at a
throwaway dir:

```bash
BERTH_HOME=/tmp/berth-test npm start      # fresh tasks/projects/settings under /tmp/berth-test
rm -rf /tmp/berth-test                     # ~/.berth is never touched
```

`BERTH_HOME` relocates only Berth's writable state — your read-only CLI session stores are still read,
so **导入目录** still finds your real sessions. For a fully empty sandbox (no sessions either), override
`HOME` instead.

---

## Development

Berth is Node 20 + TypeScript (ESM), `express` + `ws`, `node-pty`, `better-sqlite3`, `@xterm/xterm`.

- **`docs/ARCHITECTURE.md`** — module map, the persistent-PTY model, data model, API surface, and the
  landmines. **Start here** before changing the launch/terminal path or data layer.
- **`DEVELOPMENT.md`** — setup, build, test, and project conventions.

```bash
npm start        # vendor assets + run the dev server (tsx, no build step)
npm test         # unit tests (live tests gated behind BERTH_LIVE=1)
npm run build    # produce dist/ (esbuild) for the CLI/Electron forms
```

---

## License

ISC.
