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

This installs the Berth CLI, installs the bundled `berth-tasks` skill into your local agents, then
starts the app and opens the UI.

Useful commands after startup:

```bash
berth task list
berth task add "Ship the onboarding polish"
berth project list
```

### Option 2: macOS desktop app

Download the latest DMG from
[GitHub Releases](https://github.com/xiawenxing/Berth/releases/latest), open it, and drag **Berth**
into Applications.

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

## Requirements

- macOS is the primary supported platform.
- Node 20+ is required for the npm package path.
- At least one supported agent CLI on your `PATH`: `claude`, `codex`, or `coco`.

## How You Use It

1. Import or create a project.
2. Add tasks to the project board.
3. Launch Claude, Codex, or Coco from a task.
4. Resume live sessions from Berth whenever you need to inspect or continue the work.

The bundled skill lets agents manage Berth tasks/projects for you through `berth task` and
`berth project`.

## Optional Integrations

Berth can sync tasks with external systems through optional data-source adapters. These are disabled
unless configured locally in Settings; the core app works without them.

## Development

Contributor setup, local debugging, tests, and packaging details live in
[DEVELOPMENT.md](DEVELOPMENT.md).

## License

ISC.
