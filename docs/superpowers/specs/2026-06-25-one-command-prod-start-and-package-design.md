# One-command production start + distributable package

> Spec — 2026-06-25. Branch: `release/berth-2.0-ia`.

## Problem

Berth 2.0 currently runs as **two processes** in development: the Node backend (`npm start` /
`npm run serve`) and the Vite dev server (`cd web && npm run dev`). That split is fine for dev but
painful for a "production" run, and there is no clean way to hand a colleague a working build. The
owner wants (a) a **single command** to start Berth in production form, and (b) a **distributable
package** colleagues can install and use.

## Current state (verified)

- The single Node backend (`dist/server/index.js`) **already serves both frontends**: the 2.0 React
  SPA at `/app` (from `web/dist`, Vite `base: '/app/'`) and the frozen 1.0 vanilla UI at `/`.
- `npm run build` already builds everything: `vendor` → esbuild core (`dist/`) → `web build`
  (`web/dist`).
- `berth start` (`bin/berth.mjs` → `dist/cli.js` → `start()`) already boots the server one-command
  and opens a browser — but it opens root `/` (the **1.0** UI).
- An Electron path already exists (`electron/main.cjs`, `electron-builder.yml`,
  `scripts/electron-release.mjs`) producing `.dmg`/`.zip`/`.exe`/AppImage.
- `package.json` `files:` includes `web/dist` + `dist` + `public` + `bin`; `prepublishOnly` runs
  `build`. `web/dist` and `dist` are gitignored but are produced by the publish build.

### Gaps (why it feels half-done)

1. Nothing routes users to 2.0. Root `/`, `berth start --open`, and Electron's `loadURL('/')` all
   land on the frozen 1.0 UI.
2. `electron-builder.yml`'s `files:` list **omits `web/dist`** — a packaged Electron app today ships
   only the frozen 1.0 UI.
3. There is no single "build + serve" production command (only the dev two-process flow, or a manual
   `npm run build` then `berth start`).

## Decisions

- **1.0 entry is deprecated.** Root `/` becomes the 2.0 SPA entry. The 1.0 `public/` files remain on
  disk and statically served (still reachable at `/index.html` so the old client can boot if a
  server-contract path ever needs it), but nothing routes to it.
- **Delivery forms:** ship **both**. MVP = npm/npx global package (#3). Also wire the Electron desktop
  app (#1), which the owner will verify/bug-fix later. Targets: macOS + Windows.
- **One-command production run:** `npm run prod`.

## Design

### A. Make 2.0 the default (shared by all delivery forms)

In `src/server/index.ts` `createApp()`, when `web/dist` resolves (`WEB_DIST` truthy), register a
redirect for the bare root **before** `express.static(PUBLIC)`:

```
if (WEB_DIST) {
  app.get('/', (_req, res) => res.redirect(302, '/app/'))
  app.use('/app', express.static(WEB_DIST))
  app.get('/app', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')))
}
app.use(express.static(PUBLIC))   // 1.0 files still served (e.g. /index.html), but / no longer routes here
```

`start()` returns `{ port, hasWeb }` (`hasWeb = !!WEB_DIST`). The CLI uses `hasWeb` to open the right
URL (see B). When `web/dist` is absent (e.g. a dev backend with the SPA never built), root falls back
to serving `public/index.html` as before, so dev is unaffected.

### B. One-command production run

- `src/cli.ts`: `berth start --open` opens `http://host:port/app/` when `hasWeb`, else
  `http://host:port`. (Redirect already covers it; opening `/app/` directly avoids a hop.)
- `package.json`: add `"prod": "npm run build && node bin/berth.mjs start"`. One command builds
  vendor + core + SPA, then serves the whole thing from a single process. Dev flow
  (`npm start` + `web dev`) is unchanged.

### C. MVP — npm/npx global package (#3)

Colleagues run `npx @corusco/berth@latest start` (or `npm i -g @corusco/berth` then `berth start`):
one command, browser opens 2.0.

- Confirm `npm pack` includes `web/dist` (gitignored but listed in `files:` — npm should include it;
  verify with `npm pack --dry-run`).
- **Native-module risk:** `better-sqlite3` and `node-pty` are native addons. Colleague installs rely
  on prebuilt binaries for their Node/OS (esp. Windows). Verify prebuilds resolve and that
  `scripts/postinstall.mjs` does not hard-fail on a clean machine. Document the failure-and-rebuild
  path if a prebuild is missing.
- Document prerequisites in the README: **Node 20+**, and the agent CLIs (claude / codex / coco)
  installed for actual session launching.

### D. Electron desktop app (#1, owner-verified-later), mac + win

- **Fix `electron-builder.yml`**: add `web/dist` to `files:`. (Static reads from inside an asar work
  in Electron; add `web/dist` to `asarUnpack` only if a read issue surfaces during verification.)
- `electron/main.cjs`: load `http://127.0.0.1:${port}/app/` directly (belt-and-suspenders with the
  root redirect from A).
- `npm run electron:release` already builds installers to `release/`.
  **Constraint to document:** building the Windows `nsis` installer from macOS needs wine/mono —
  realistically a Windows machine or a CI runner. macOS `.dmg`/`.zip` builds locally.

## Testing

- **Unit:** `createApp()` redirects `/` → `/app/` when `WEB_DIST` is present, and serves the 1.0
  fallback at `/` when it is not. `parseCliArgs` open-target behavior is already covered.
- **Manual:** `npm run prod` → 2.0 loads at the opened URL, PTY/terminal sessions work;
  `npm pack --dry-run` lists `web/dist/**`.
- **Electron (later):** `npm run electron:release` on macOS → install the `.dmg`, confirm the app
  opens the 2.0 UI and PTY sessions work.

## Out of scope

- Removing or rewriting the 1.0 `public/` tree (only its entry routing is deprecated).
- Code signing / notarization of the Electron app (later step; `notarize: false` today).
- A CI pipeline for cross-platform Electron builds (documented as a constraint, not built here).
- Auth / multi-user / non-loopback hardening (server stays single-user, loopback by default).
