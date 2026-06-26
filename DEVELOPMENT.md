# Developing Berth

This guide is for contributors working on Berth itself. For what Berth is and how to use it, see the
[README](README.md). For the deep technical map — module layout, the persistent-PTY model, data model,
API surface, and the landmines that cost real debugging time — read
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.**

## Stack

Node 20 · TypeScript (ESM) · `express` + `ws` · `node-pty` · `better-sqlite3` · `@xterm/xterm` ·
`marked`. Tests run on `vitest`.

## Prerequisites

- **Node 20+.**
- A C/C++ build toolchain for the native modules (`node-pty`, `better-sqlite3`). On macOS the Xcode
  command-line tools suffice; on Linux install `python3`, `make`, and a C++ compiler
  (`build-essential` / `gcc-c++`). macOS and Windows get prebuilt binaries; Linux compiles `node-pty`
  from source.
- At least one agent CLI (`claude`, `codex`, or `coco`) on your `PATH` if you want to exercise the
  launch/terminal path.

## The dev loop

The public npm/GitHub README intentionally describes only end-user installs (npm package + skill, or
the signed DMG). Source checkout setup and local debugging commands live here.

```bash
npm install        # first time, or after a dependency change
npm start          # vendor assets + run the dev server (via tsx, no build) → http://localhost:7777
npm test           # unit tests
npx tsc --noEmit   # type-check
```

- **`npm start`** runs `scripts/vendor.mjs` (copies `xterm` + `marked` and builds the lucide icon
  sprite into `public/vendor/`) and then serves via `tsx` — there is no build step in dev.
- Override the bind address: `PORT=7788 HOST=127.0.0.1 npm start`.
- **`npm run vendor`** re-copies the vendored frontend libs; only needed after a dependency bump.
  Vendored artifacts are committed, so a fresh checkout renders without running it first.
- **`npm run build`** produces `dist/` via esbuild — used by the `berth` CLI and the Electron build,
  not by the dev server.

## Desktop release

```bash
npm run electron:dev       # local desktop smoke test; rebuilds native addons in-tree
npm run electron:release   # publishable installer build in an isolated worktree
```

macOS DMGs for public download must be Developer ID signed and notarized. `npm run electron:release`
fails before building unless the machine has a `Developer ID Application` identity available through
the keychain, `CSC_LINK`, or `CSC_NAME`, plus one complete notarization credential set:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `APPLE_KEYCHAIN_PROFILE` (with optional `APPLE_KEYCHAIN`)

After packaging, the script verifies the generated `.app` with `codesign --verify --deep --strict`
and `spctl --assess`. Do not upload a DMG that bypasses those checks; downloaded unsigned builds show
macOS Gatekeeper's "app is damaged" error.

For an internal/test DMG where the "unidentified developer" warning is acceptable, run
`BERTH_ALLOW_UNNOTARIZED_MAC=1 npm run electron:release`. This uses ad-hoc signing and skips
notarization; users must approve the app manually in macOS Gatekeeper.

### Working without touching your real data

Berth's writable state lives under `~/.berth`. Point `BERTH_HOME` at a throwaway dir to run against a
fresh, empty store:

```bash
BERTH_HOME=/tmp/berth-dev npm start
rm -rf /tmp/berth-dev
```

`BERTH_HOME` relocates only Berth's own state; your read-only CLI session stores are still read. For a
fully empty sandbox (no sessions either), override `HOME` instead.

## Testing

- `npm test` runs the unit suite. It mocks the CLI/spawn boundary (e.g. `lark-cli`).
- `*.live.test.ts` spawn real CLIs / touch real stores and are **gated behind `BERTH_LIVE=1`**:
  `npm run test:live`. The cold-spawn binary tests can flake (e.g. `coco --help` is slow) — re-run
  before treating a failure as a regression.
- Keep `npx tsc --noEmit` clean and `npm test` green before committing.

## Project layout

```
src/        backend — adapters (session ingestion), data layer (canonical store + sync seam),
            pty/ (launch + terminal), server/ (express + ws + REST/WS API)
public/     frontend — currently a no-build, vanilla-<script> app (interim; see below)
bin/        CLI + server entrypoints
scripts/    vendor / build / postinstall / electron-release helpers
electron/   Electron main process
test/       vitest unit + *.live.test.ts integration tests
docs/       ARCHITECTURE.md — the canonical technical reference
```

See `docs/ARCHITECTURE.md` for the per-module breakdown and the data model.

> **On the vanilla frontend:** the UI today is a no-build, plain-`<script>` setup — a **demo-stage
> shortcut, not a principle.** The target is a built React SPA with a proper frontend/backend split;
> the design-system foundation (`public/tokens.css` — oklch dual-theme tokens, the shape Tailwind/shadcn
> use) is already in place. Don't treat "no build / no framework" as a constraint to defend. See the
> Roadmap in `docs/ARCHITECTURE.md`.

## Conventions

- **Commit early and often**, in logical chunks — one self-contained change (a fix, a feature, a
  refactor) per commit with a clear message.
- **Never commit on a broken build:** `npx tsc --noEmit` clean and `npm test` green first.
- Do not commit or push directly on `main`. All changes start on a `release/<version-or-scope>`
  branch, and `main` only accepts merges from release branches after the build and tests are green.
- For two or more genuinely independent tasks in flight, use a separate git worktree per task so
  branches don't collide:
  ```bash
  git worktree add ../berth-<task> -b release/<version-or-scope>-<task>
  ```
- Match the surrounding code's style, naming, and comment density.

## Configuration & secrets

No personal or machine-specific values belong in source. Connection config (data-source ids, field
maps, docs roots, etc.) is routed through `data_source.config_json` / `app_setting` and seeded once
from a **local, untracked** `~/.berth/seed.json` (or `BERTH_SEED_JSON`). `~/.berth/`, `seed.json`, and
`.claude/settings.local.json` are git-ignored — never commit them.
