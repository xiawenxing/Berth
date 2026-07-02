# Berth — agent working conventions

Read **`docs/ARCHITECTURE.md` first** (module map, the persistent-PTY model, data model, API surface,
and the landmines that cost real debugging time). This file is just the working rules.

## ⚠️ The frontend lives in `web/` (Berth 2.0) — `public/` is FROZEN

There are **two** frontends in this repo. Know which one you're editing:

- **`web/`** — the **React SPA (Berth 2.0)**, Vite + TypeScript + Tailwind. **This is the active
  frontend.** All new features, UI changes, and frontend bug fixes go here.
- **`public/`** (`app.js`, `style.css`, `tokens.css`, `index.html`) — the legacy vanilla-JS 1.0 UI.
  It is **paused / maintenance-frozen**. Do **not** add features or UI changes here.

If a task asks for a frontend change and you find yourself editing `public/`, **stop** — the change
almost certainly belongs in `web/` instead. (This branch already accumulated several 1.0-only commits
— image-paste, empty-board CTA, launch-scope fix — that had to be re-done or migrated into `web/`;
don't add more.) Only touch `public/` for a server-contract change the old client still needs to keep
booting, and call that out explicitly. The shared backend is `src/` (Node server + REST/WS) — that
serves both, so backend work is normal regardless.

## Commit conventions — commit promptly, in logical chunks

- **Commit early and often.** Each self-contained change (a fix, a feature, a refactor) gets its own
  commit with a clear message — don't let a large body of work pile up uncommitted. (This repo once
  accumulated an entire app's worth of work in the working tree with `HEAD` stale; don't repeat that.)
- After finishing a coherent unit and seeing tests green (`npm test`), commit it. You don't need to
  ask each time — committing your own completed work is expected. (If the owner explicitly says
  "don't commit" for a given task, honor that for that task.)
- **Never commit on a broken build.** `npx tsc --noEmit` clean + `npm test` green before you commit.
- `main` is protected by convention: do **not** commit or push directly to `main`.
- All code/doc changes must be made on a `release/<version-or-scope>` branch. `main` only receives
  merges from release branches after tests pass. Push only if asked.

## ⚠️ Dev workflow — mandatory (this has been violated too many times)

**1. EVERY dev task runs in its own isolated git worktree, on a branch cut from the current
in-flight `release/x.x.x`** (the latest unreleased version that will merge back to `main`). This is
**not** just for parallel work — it is the default for *every* task, even a one-line fix.

```bash
# branch from the active release/x.x.x into a fresh worktree:
git worktree add ../berth-<task> -b <branch> release/x.x.x
# ...develop + commit there, tests green...
git worktree remove ../berth-<task>      # after it's merged back
```

- **NEVER develop directly in the current / shared working tree or on the currently-checked-out
  branch.** Concurrent Berth sessions routinely switch branches, `reset`, and commit in the main
  working tree — working there gets your uncommitted changes swept into someone else's commit, or
  your branch yanked out from under you. This has happened repeatedly. An isolated worktree is the
  only safe posture.
- **The controlling session must not camp in the main checkout either — not even for "just looking".**
  The repo's primary clone (`…/berth`) is a *communal* tree any session may switch out from under you;
  if your shell's default cwd lives there and you run even read-only `git log/branch/status` there,
  you'll keep seeing it lurch between branches. So the **first** thing a session does for any work is
  create its own worktree, then run **all** operations from inside it — inspection git commands
  included. Treat the primary clone as a no-camp public entrance, not a workspace. (Even this doc edit
  was made from a dedicated worktree.)
- **Caveat — a worktree isolates the working dir + index + HEAD, NOT the ref namespace.** All worktrees
  share one `.git`; branches/refs are global. A worktree protects *your files and which branch your dir
  is on*, but a concurrent session can still `branch -f` / `reset` / delete any branch (including the
  one you're on), visible everywhere. Worktrees *reduce* cross-session interference; they don't
  eliminate it. Corollary: **never force-update or delete a branch another worktree/session has checked
  out**, and don't be surprised that refs move globally.
- Worktree setup: symlink `node_modules` (+ `web/node_modules`) and use **Node 20** (better-sqlite3
  ABI) or you'll hit phantom test failures.

**2. Merge only — `rebase` is BANNED in this repo.** Integrate finished branches back with
`git merge` (keep the merge history). **Do not `rebase`, do not `rebase --onto`, do not rewrite
commits** for a "linear history" — not even to clean up churn left by a parallel session. When the
upstream branch looks messy, resolve it with a merge.

**3. When the task is done and green, merge the branch back into the same `release/x.x.x`** it was
cut from, then `git worktree remove` and delete the branch. Do this on your own initiative — no need
to ask permission to branch/worktree/merge.

## Release flow

When cutting a release of `release/x.x.x`:

1. Run the **full test suite + typecheck** on `release/x.x.x` — backend `npm test` and `web` tests,
   `npx tsc --noEmit` clean both sides.
2. **Build/package**: the npm package and/or the Electron app build, verified.
3. **Publish** the release.
4. **After** publishing, merge `release/x.x.x` back into `main` (`main` is protected — it only ever
   receives release-branch merges after a release; never commit/push to it directly).
5. Cut the next version's `release/<next>` branch off `main` to carry subsequent development.

## Build / test

- `npm start` — vendors xterm+marked, starts the server (default `:7777`, `PORT` overrides).
- `npm test` — unit tests. `*.live.test.ts` are gated behind `BERTH_LIVE=1` (they spawn real CLIs /
  touch real stores; `coco --help` is slow so the binaries test can flake cold — re-run).
- Frontend is **currently** a no-build, plain-`<script>` setup; `npm run vendor` copies xterm/marked
  (and builds the lucide sprite) into `public/vendor/`. **This is a demo-stage shortcut, not a
  principle** — the target is a built React SPA + frontend/backend split (see the Roadmap in
  `docs/ARCHITECTURE.md`). Don't treat "no build / no framework" as a constraint to defend.
