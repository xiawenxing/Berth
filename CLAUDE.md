# Berth — agent working conventions

Read **`docs/ARCHITECTURE.md` first** (module map, the persistent-PTY model, data model, API surface,
and the landmines that cost real debugging time). This file is just the working rules.

## Commit conventions — commit promptly, in logical chunks

- **Commit early and often.** Each self-contained change (a fix, a feature, a refactor) gets its own
  commit with a clear message — don't let a large body of work pile up uncommitted. (This repo once
  accumulated an entire app's worth of work in the working tree with `HEAD` stale; don't repeat that.)
- After finishing a coherent unit and seeing tests green (`npm test`), commit it. You don't need to
  ask each time — committing your own completed work is expected. (If the owner explicitly says
  "don't commit" for a given task, honor that for that task.)
- **Never commit on a broken build.** `npx tsc --noEmit` clean + `npm test` green before you commit.
- The default branch is `main`. For anything non-trivial, **work on a branch**, not directly on
  `main`. Push only if asked.

## Parallel tasks — use worktrees + branches autonomously

When you have **two or more independent tasks in flight** (e.g. a backend change and an unrelated UI
change, or you're asked to start B while A is mid-review), **don't interleave them in one working
tree.** Spin up an isolated git worktree per task so each has its own branch and clean state:

```bash
git worktree add ../berth-<short-task-name> -b feat/<short-task-name>
# work there; commit on that branch; when merged/abandoned:
git worktree remove ../berth-<short-task-name>
```

This keeps parallel work from colliding and keeps each branch's history coherent. Do it on your own
initiative — you don't need to ask for permission to branch/worktree for parallel work. Merge back to
`main` (or open a PR) when a task is done and green; clean up the worktree afterward.

A single linear task does **not** need a worktree — just a branch (or commit straight on a feature
branch). Reserve worktrees for genuinely concurrent work.

## Build / test

- `npm start` — vendors xterm+marked, starts the server (default `:7777`, `PORT` overrides).
- `npm test` — unit tests. `*.live.test.ts` are gated behind `BERTH_LIVE=1` (they spawn real CLIs /
  touch real stores; `coco --help` is slow so the binaries test can flake cold — re-run).
- Frontend is **currently** a no-build, plain-`<script>` setup; `npm run vendor` copies xterm/marked
  (and builds the lucide sprite) into `public/vendor/`. **This is a demo-stage shortcut, not a
  principle** — the target is a built React SPA + frontend/backend split (see the Roadmap in
  `docs/ARCHITECTURE.md`). Don't treat "no build / no framework" as a constraint to defend.
