<div align="center">

# Berth

### The cockpit for AI-driven work.

**Organize every agent session around your projects and tasks, and drive them to done.**

[![npm](https://img.shields.io/npm/v/@corusco/berth?color=2563eb&label=npm)](https://www.npmjs.com/package/@corusco/berth)
[![node](https://img.shields.io/badge/node-%E2%89%A520-43853d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-ISC-blue)](#license)
[![platform](https://img.shields.io/badge/platform-macOS-lightgrey)]()

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## What is Berth?

Berth is a local cockpit for AI-agent work. It gives you one workspace for:

- **Projects and tasks**: a local task board, project workspaces, priorities, statuses, and markdown
  context docs.
- **Agent sessions**: one live session list across Claude Code, Codex, and Coco, resumed in embedded
  terminals.
- **Task-driven launches**: launch an agent from a task with the right project/task context injected,
  then keep the work attached to the task.

Berth is local-first. It reads each CLI's session store read-only, keeps its own state under
`~/.berth`, and does not require cloud accounts or external integrations.

## Install

Choose one path.

### Option 1: npm package

```bash
npm install -g @corusco/berth && berth skill install && berth start
```

### Option 2: macOS desktop app

Download the latest DMG from
[GitHub Releases](https://github.com/xiawenxing/Berth/releases/latest), open it, and drag **Berth**
into Applications.

If you want agents inside Berth sessions to use `berth task` / `berth project` directly, open Berth
and use **Settings → Agent Integration** to install the CLI shim and bundled `berth-tasks` skill.

#### First launch (one-time)

Berth's macOS builds are ad-hoc signed but **not** notarized through Apple's paid Developer Program,
so Gatekeeper shows a warning the first time you open it. The app is unmodified — you just have to
approve it once:

1. Open **Applications**, then **right-click (Control-click) Berth → Open**.
2. Click **Open** in the dialog that appears.

That's it — after this one approval, Berth opens normally on every double-click from then on.

> Do **not** double-click on the very first launch. Double-clicking an un-approved download gives a
> dead-end "*Apple cannot check it for malicious software*" dialog with no Open button. Use
> right-click → Open instead.

If right-click → Open is blocked (macOS 15 Sequoia removed that shortcut for unnotarized apps), or
you'd rather skip the warning entirely, run this once in Terminal to strip the download-quarantine
flag, then launch normally:

```bash
xattr -dr com.apple.quarantine /Applications/Berth.app
```

### Recommended Agent Integration

npm package users can run:

```bash
berth skill install
```

DMG users can use **Settings → Agent Integration** to install/update the CLI shim and bundled
`berth-tasks` skill in one click.

The bundled skill lets agents manage Berth tasks/projects for you through `berth task` and
`berth project`.

## Requirements

- macOS is the primary supported platform.
- Node 20+ is required for the npm package path.
- At least one supported agent CLI on your `PATH`: `claude`, `codex`, or `coco`.

## How You Use It

1. Create a project and launch from a task.

Start an agent for the task with one click:

- You do not need to manually restate context: the agent automatically reads project context and task
  context. Multiple agents can maintain the task context together, so progress records naturally carry
  forward.
- The task status moves with the agent lifecycle: after launch, you can leave the session running and
  manage in-flight work from the task view.

<img width="2006" height="1034" alt="Berth project task launch screenshot" src="https://github.com/user-attachments/assets/e494037f-8af6-4331-a8a9-6bb0ef34b03d" />

2. Import existing sessions.

- Import local agent sessions and bind them to tasks.

<img width="2006" height="1034" alt="Berth imported sessions screenshot" src="https://github.com/user-attachments/assets/ec48de57-74f8-4a00-8d55-7ba0672c9de6" />

## License

ISC.
