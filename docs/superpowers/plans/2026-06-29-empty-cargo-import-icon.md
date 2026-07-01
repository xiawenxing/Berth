# Empty-Cargo Import Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide mounted-but-empty directories from the session list, and add a per-row "导入会话" icon in the 装载区域 (`CargoDefaults`) as their import entry point.

**Architecture:** Pure `web/` frontend change. (1) Stop appending `emptyCargoGroups()` to session-list groups and delete that now-unused module + test. (2) Remove the now-dead empty-placeholder branch in `SessionModule`. (3) Add a `FolderInput` import icon to each `CargoDefaults` row that opens the component's existing `ImportDialog` in `mode="import"` (import-only, never re-registers).

**Tech Stack:** React 18 + TypeScript + Tailwind, Vite, Vitest, lucide-react icons. Test runner: `npm test` (= `vitest run`) inside `web/`. Typecheck: `npx tsc --noEmit`.

**Working dir:** worktree `../berth-empty-cargo-import`, branch `feat/empty-cargo-import-icon` (off `release/2.0.3`). Run all commands from the worktree root unless noted. Frontend commands run inside `web/`.

---

### Task 1: Stop generating empty cargo groups; delete the dead module

This is a behavioral removal: the only non-test caller of `emptyCargoGroups` is `ProjectWorkspace.tsx:205`. Once removed, the whole `cargo-groups.ts` module (and its lone helper `normCwd`, which has no other callers) is dead, so we delete it and its test.

**Files:**
- Modify: `web/src/pages/ProjectWorkspace.tsx` (line 22 import; lines ~203–205 return)
- Delete: `web/src/lib/cargo-groups.ts`
- Delete: `web/src/lib/cargo-groups.test.ts`

- [ ] **Step 1: Confirm there are no other references**

Run (from worktree root):
```bash
grep -rn "emptyCargoGroups\|cargo-groups" web/src
```
Expected: matches ONLY in `web/src/lib/cargo-groups.ts`, `web/src/lib/cargo-groups.test.ts`, and `web/src/pages/ProjectWorkspace.tsx`. If any other file references it, stop and reassess.

- [ ] **Step 2: Remove the import in `ProjectWorkspace.tsx`**

Delete this line (line 22):
```ts
import { emptyCargoGroups } from '@/lib/cargo-groups'
```

- [ ] **Step 3: Drop the empty-groups spread from the grouping return**

In `ProjectWorkspace.tsx`, replace the comment + return (currently ~lines 203–205):
```ts
    // Registered 装载目录 with no session yet → empty groups, appended AFTER 主上下文 is fixed
    // (an empty dir must never be picked as 主上下文). Each keeps its 导入 icon as a re-import entry.
    return [...sessionGroups, ...emptyCargoGroups(project?.pathsMeta, map.keys(), ws)]
```
with:
```ts
    // 装载目录 with no imported session yet are NOT surfaced here — their import entry point
    // lives on the 装载区域 row icon (CargoDefaults). Only session-derived groups appear.
    return sessionGroups
```

Note: `map` and `ws` may now be unused in this `useMemo` if they were only consumed by the deleted call. After editing, the `tsc` step below will flag any now-unused locals — remove only ones that become genuinely unused, and leave `map`/`ws` if still used elsewhere in the block.

- [ ] **Step 4: Delete the dead module and its test**

Run:
```bash
git rm web/src/lib/cargo-groups.ts web/src/lib/cargo-groups.test.ts
```

- [ ] **Step 5: Typecheck**

Run (inside `web/`):
```bash
cd web && npx tsc --noEmit; cd ..
```
Expected: no errors. If it reports an unused `map`/`ws`/`NO_CWD`-related local introduced by Step 3, remove that now-unused local and re-run until clean.

- [ ] **Step 6: Run the test suite**

Run (inside `web/`):
```bash
cd web && npm test; cd ..
```
Expected: PASS. The deleted `cargo-groups.test.ts` no longer runs; no remaining test should reference it. If another test fails referencing empty-group presence, update that test's expectation so an empty mount produces no session-list group (search with `grep -rn "装载目录\|emptyCargo" web/src`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(web): stop surfacing empty 装载目录 as session-list groups"
```

---

### Task 2: Remove the now-dead empty placeholder in `SessionModule`

Session-derived groups always have ≥1 row, so `isEmpty` (rows.length === 0) is now never true. Remove the dead branch and simplify the `hasGroupMenu` guard. The per-group header import icon (`onImport`) for non-empty groups is unchanged.

**Files:**
- Modify: `web/src/components/workspace/SessionModule.tsx` (lines ~449–450, ~531–537)

- [ ] **Step 1: Remove the `isEmpty` local and simplify `hasGroupMenu`**

Replace (currently lines 449–450):
```ts
  const isEmpty = rows.length === 0 // a registered 装载目录 with no session yet
  const hasGroupMenu = !isEmpty && !!(onDetachGroup || onUnimportGroup)
```
with:
```ts
  const hasGroupMenu = !!(onDetachGroup || onUnimportGroup)
```

- [ ] **Step 2: Remove the empty-placeholder branch**

Delete this block (currently lines 531–537), inside the `{!collapsed && (<div> ... )}` body, immediately before `{visible.map((s) => (`:
```tsx
          {isEmpty && (
            <div className="border-t border-border/55 px-3.5 py-2.5 text-[12px] text-text-dim">
              该目录暂无项目会话 · 点
              <FolderInput size={12} className="mx-1 -mt-0.5 inline align-middle text-text-dim" />
              从磁盘导入
            </div>
          )}
```
Leave the rest of the `{!collapsed && ...}` block (the `{visible.map(...)}` and `{limited && ...}`) intact. Do NOT remove the `FolderInput` import — it is still used by the header import icon at line ~482.

- [ ] **Step 3: Typecheck**

Run (inside `web/`):
```bash
cd web && npx tsc --noEmit; cd ..
```
Expected: no errors (in particular no "isEmpty is declared but never read").

- [ ] **Step 4: Run the test suite**

Run (inside `web/`):
```bash
cd web && npm test; cd ..
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/workspace/SessionModule.tsx
git commit -m "refactor(web): drop dead empty-group placeholder in SessionModule"
```

---

### Task 3: Add per-row import icon + import-mode dialog in `CargoDefaults`

Each registered directory row gets a `FolderInput` icon between its `Toggle` and `X`. Clicking it previews the directory's on-disk sessions and opens the existing `ImportDialog` in `mode="import"`. The import-only confirm path calls `api.importSessions` ONLY — it must not call `api.addPath`, so importing into a toggled-off directory never silently re-enables it.

**Files:**
- Modify: `web/src/components/workspace/CargoDefaults.tsx` (imports line 2; `dialog` state line 61; `onConfirm` lines ~92–105; `RegRow` right span lines ~188–195; `ImportDialog` usage lines ~210–217)

- [ ] **Step 1: Add the `FolderInput` icon to the lucide import**

Replace (line 2):
```ts
import { ChevronDown, ChevronRight, FileText, Folder, Package, Plus, X } from 'lucide-react'
```
with:
```ts
import { ChevronDown, ChevronRight, FileText, Folder, FolderInput, Package, Plus, X } from 'lucide-react'
```

- [ ] **Step 2: Add a `mode` to the dialog state**

Replace (line 61):
```ts
  const [dialog, setDialog] = useState<{ path: string; sessions: PreviewSession[] } | null>(null)
```
with:
```ts
  const [dialog, setDialog] = useState<{ path: string; sessions: PreviewSession[]; mode: 'register' | 'import' } | null>(null)
```

- [ ] **Step 3: Tag the existing add-dir flow as `mode: 'register'`**

In `onAddDir`, replace (currently line 83):
```ts
      setDialog({ path: picked.path, sessions })
```
with:
```ts
      setDialog({ path: picked.path, sessions, mode: 'register' })
```

- [ ] **Step 4: Add the per-row import handler**

Immediately after the `onAddDir` function (after its closing `}` near line 89), add:
```ts
  // Per-row 导入会话: preview the already-registered dir's on-disk sessions and open the dialog in
  // import-only mode. Preview failures are non-fatal (button no-ops), mirroring onAddDir.
  const onImportRow = async (cwd: string) => {
    try {
      const { sessions } = await api.previewDir(cwd)
      setDialog({ path: cwd, sessions, mode: 'import' })
    } catch {
      // preview failure — no-op
    }
  }
```

- [ ] **Step 5: Branch `onConfirm` on the dialog mode**

Replace the whole `onConfirm` function (currently lines ~91–105):
```ts
  // 添加目录 confirm: ALWAYS register the dir (add-path, enabled), THEN import the picked sessions.
  const onConfirm = async (ids: string[]) => {
    if (!dialog || !projectId) return
    setBusy(true)
    try {
      await api.addPath(projectId, dialog.path, { enabled: true })
      if (ids.length) await api.importSessions(ids, projectId)
      setDialog(null)
      onDone?.()
    } catch {
      // leave the dialog open on error so the user can retry
    } finally {
      setBusy(false)
    }
  }
```
with:
```ts
  // Confirm. 'register' (添加目录): register the dir THEN import the picked sessions. 'import'
  // (per-row icon): the dir is already registered — import ONLY, never re-addPath (that would
  // force enabled:true and silently re-enable a directory the user toggled off).
  const onConfirm = async (ids: string[]) => {
    if (!dialog || !projectId) return
    setBusy(true)
    try {
      if (dialog.mode === 'register') {
        await api.addPath(projectId, dialog.path, { enabled: true })
      }
      if (ids.length) await api.importSessions(ids, projectId)
      setDialog(null)
      onDone?.()
    } catch {
      // leave the dialog open on error so the user can retry
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 6: Render the import icon in each row's right span**

Replace the row's `right` span (currently lines ~188–195):
```tsx
              right={
                <span className="flex items-center gap-2">
                  <Toggle on={d.enabled} onChange={() => toggle(d.cwd, !d.enabled)} />
                  <button onClick={() => (onRemovePath ? onRemovePath(d.cwd) : remove(d.cwd))} title="移除" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-destructive">
                    <X size={13} />
                  </button>
                </span>
              }
```
with:
```tsx
              right={
                <span className="flex items-center gap-2">
                  <Toggle on={d.enabled} onChange={() => toggle(d.cwd, !d.enabled)} />
                  <button onClick={() => onImportRow(d.cwd)} title="导入该目录下磁盘上的会话" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-brand">
                    <FolderInput size={13} />
                  </button>
                  <button onClick={() => (onRemovePath ? onRemovePath(d.cwd) : remove(d.cwd))} title="移除" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-destructive">
                    <X size={13} />
                  </button>
                </span>
              }
```

- [ ] **Step 7: Pass the dialog mode into `ImportDialog`**

Replace the `ImportDialog` usage (currently lines ~210–217):
```tsx
        <ImportDialog
          path={dialog.path}
          sessions={dialog.sessions}
          mode="register"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={onConfirm}
        />
```
with:
```tsx
        <ImportDialog
          path={dialog.path}
          sessions={dialog.sessions}
          mode={dialog.mode}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={onConfirm}
        />
```

- [ ] **Step 8: Typecheck**

Run (inside `web/`):
```bash
cd web && npx tsc --noEmit; cd ..
```
Expected: no errors.

- [ ] **Step 9: Run the test suite**

Run (inside `web/`):
```bash
cd web && npm test; cd ..
```
Expected: PASS.

- [ ] **Step 10: Manual verification (dev server)**

Run `npm start` from the worktree root (default `:7777`; set `PORT` if busy), open the app, pick a project, and verify:
1. Mount a directory with no imported sessions → it shows ONLY in 装载区域, not in the session list.
2. Each 装载区域 row shows a folder-import icon between the toggle and the ✕.
3. Clicking the icon opens the 导入会话 dialog titled "导入会话" listing that directory's on-disk sessions; importing one makes a normal (non-empty) group appear in the session list.
4. Toggle a directory OFF, then import a session via its icon → after import the directory is STILL off (the import did not re-enable it).

- [ ] **Step 11: Commit**

```bash
git add web/src/components/workspace/CargoDefaults.tsx
git commit -m "feat(web): per-row 导入会话 icon in 装载区域 (import-only, no re-register)"
```

---

### Wrap-up (after all tasks)

- [ ] **Full green gate:** from worktree root run `cd web && npx tsc --noEmit && npm test; cd ..` — typecheck clean, tests green. (Backend `src/` is untouched, but if the owner wants the full gate, also run root `npm test`.)
- [ ] **Merge back** into `release/2.0.3` with `git merge` (NOT rebase — rebase is banned in this repo), then `git worktree remove ../berth-empty-cargo-import` and delete the branch. Do not push unless asked.
