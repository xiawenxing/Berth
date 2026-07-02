# Empty-cargo directories: hide from session list, import from 装载区域

**Date:** 2026-06-29
**Branch:** `feat/empty-cargo-import-icon` (worktree off `release/2.0.3`)
**Scope:** `web/` frontend only — no backend / API changes.

## Problem

A directory can be **mounted** (registered in `project.pathsMeta`, shown in the 默认装载 / 货舱
area) without having any **imported sessions**. Today such an empty directory still appears in the
session list as an empty group (placeholder "该目录暂无项目会话 · 点🗁从磁盘导入"). This clutters
the session list with rows that have no sessions.

## Goal

1. A mounted-but-empty directory no longer appears in the session list at all.
2. The "import sessions from this directory" entry point moves to an icon next to each directory's
   toggle in the 装载区域 (`CargoDefaults`).

## Decisions (confirmed with owner)

- The import icon appears on **every** mounted-directory row (not only empty ones). Directories that
  *do* have sessions keep their existing per-group import icon in the session list as well.
- Empty cargo groups are **never generated** for the session list (no hidden/toggle fallback).

## Current behavior (as-is)

- `web/src/lib/cargo-groups.ts` — `emptyCargoGroups(pathsMeta, usedCwds, ws)` builds `CwdGroup`
  entries (with `sessions: []`, `tag: '装载目录'`) for registered dirs that have no imported
  sessions. Its helper `normCwd` is used only inside this module + its test; no other callers.
- `web/src/pages/ProjectWorkspace.tsx:205` —
  `return [...sessionGroups, ...emptyCargoGroups(project?.pathsMeta, map.keys(), ws)]` appends those
  empty groups to the session-list groups. This is the **only** non-test caller of the module.
- `web/src/components/workspace/SessionModule.tsx` — `Section` renders each group; an `isEmpty`
  branch (rows.length === 0, ~lines 531–536) shows the empty placeholder + a `FolderInput` import
  icon. Because session-derived groups always have ≥1 row, `isEmpty` only ever fires for
  `emptyCargoGroups` output. The per-group import icon in the section header (~lines 471–483, shown
  when `onImport` is provided) stays for non-empty groups.
- `web/src/components/workspace/CargoDefaults.tsx` — renders 默认装载. Each registered dir is a
  `RegRow` whose `right` span holds a `Toggle` + an `X` (remove) button (~lines 188–195).
  CargoDefaults **already owns** an `ImportDialog` and its plumbing:
  - `dialog` state `{ path, sessions }`, opened by `onAddDir` via `api.previewDir`.
  - `onConfirm(ids)` does `api.addPath(path, {enabled:true})` then `api.importSessions(ids)` then
    `onDone()`.
  - Renders `<ImportDialog mode="register" .../>` at the bottom.
- `web/src/components/ImportDialog.tsx` — supports `mode: 'register' | 'import'`, prop
  `onConfirm(ids, alsoRegister?)`, and an `allowRegister` checkbox shown only in `'import'` mode.

## Design

### 1. Stop generating empty groups (session list)

- `ProjectWorkspace.tsx:205` → return just `sessionGroups` (drop the `...emptyCargoGroups(...)`
  spread) and remove the `import { emptyCargoGroups } from '@/lib/cargo-groups'`.
- Since this was the only non-test caller and `normCwd` has no external callers, **delete**
  `web/src/lib/cargo-groups.ts` and `web/src/lib/cargo-groups.test.ts` entirely.

Net effect: mounted-but-empty directories disappear from `SessionModule`.

### 2. Remove the now-dead empty placeholder (`SessionModule.tsx`)

- The `isEmpty` placeholder branch (~531–536) becomes unreachable (session-derived groups always
  have rows). Remove the dead branch and the now-unused `isEmpty` local. The per-group header import
  icon (for non-empty groups) and all other `Section` rendering are **unchanged**.

### 3. Add a per-row import icon in `CargoDefaults.tsx`

- In each directory `RegRow`'s `right` span, insert a `FolderInput` icon button **between** the
  `Toggle` and the `X` button, titled e.g. "导入该目录下磁盘上的会话". Shown on every row.
- Click handler `onImportRow(cwd)`: `const { sessions } = await api.previewDir(cwd)` →
  `setDialog({ path: cwd, sessions, mode: 'import' })`. Failures are non-fatal (no-op), mirroring
  `onAddDir`.

### 4. Wire the dialog mode + import-only confirm (`CargoDefaults.tsx`)

- Extend `dialog` state to carry a `mode`: `{ path: string; sessions: PreviewSession[]; mode:
  'register' | 'import' }`. `onAddDir` sets `mode: 'register'` (unchanged behavior).
- `onConfirm` branches on `dialog.mode`:
  - `'register'` → existing path: `addPath(path,{enabled:true})` + `importSessions(ids)` + `onDone`.
  - `'import'` → **`importSessions(ids, projectId)` only** + `onDone`. It must NOT call `addPath`
    (the dir is already registered; re-adding with `enabled:true` would silently re-enable a
    directory the user had toggled off).
- Render `<ImportDialog mode={dialog.mode} .../>`. Do **not** pass `allowRegister` (row dir is
  already registered).

## Data flow (import from a row)

icon click → `onImportRow(rawCwd)` → `api.previewDir(cwd)` → `ImportDialog` (`mode='import'`) → user
selects → `onConfirm(ids)` → `api.importSessions(ids, projectId)` → `onDone()` (refresh). The newly
imported sessions then appear as a normal (non-empty) group in the session list.

## Error handling

Reuse existing patterns: preview/import failures leave the dialog as-is or no-op (the existing
`onAddDir` swallows preview errors; `onConfirm` leaves the dialog open on error for retry). No new
error surfaces.

## Testing

- Delete `cargo-groups.test.ts` along with the module.
- Search for other tests asserting empty-group presence in the session list / ProjectWorkspace
  grouping; update expectations so empty mounts produce no group.
- `npx tsc --noEmit` clean (both root and `web`) and `npm test` green before commit.
- Manual check: mount a directory with no imported sessions → it shows only in 装载区域 (not the
  session list); clicking its import icon opens the 导入会话 dialog; importing a session makes a
  normal group appear; toggling a directory off then importing via the icon does NOT re-enable it.

## Out of scope

- No backend/API changes.
- No change to the generic "导入其他目录" button or the per-group import icon for non-empty groups.
- No change to `public/` (frozen 1.0 UI).
