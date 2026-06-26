# Show-more / show-less consistency + task-card context entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 任务上下文 list show-more/show-less pagination, give every show-more site a matching show-less, and let an expanded task card open its context doc — all sharing one `useShowMore` hook.

**Architecture:** Extract a single `useShowMore(total, initial, page)` hook (`web/src/lib/paging.ts`) plus a presentational `ShowMoreToggle` button (`web/src/components/ui/ShowMoreToggle.tsx`). Adopt them in all four list sites. Thread a new `onOpenContext` callback `ProjectWorkspace → Kanban → TaskCard` that opens the existing `ContextDocDrawer` for `tasks/<id>/index.md`.

**Tech Stack:** React + TypeScript + Tailwind (Vite SPA in `web/`), lucide-react icons. No component-test harness exists for these pieces; the verification gate per task is `cd web && npx tsc --noEmit` (clean) plus, at the end, root `npx tsc --noEmit` + `npm test` green and a manual app check.

**Spec:** `docs/superpowers/specs/2026-06-25-showmore-showless-task-context.md`

---

## File structure

- `web/src/lib/paging.ts` — keep `SESSION_SHOW_MORE_PAGE`; add `useShowMore` hook (no JSX → stays `.ts`).
- `web/src/components/ui/ShowMoreToggle.tsx` — **new** presentational toggle button (JSX → `.tsx`).
- `web/src/components/workspace/SessionModule.tsx` — `Section` refactor to hook + toggle.
- `web/src/pages/Unassigned.tsx` — `SessionGroup` refactor to hook + toggle.
- `web/src/components/ImportDialog.tsx` — adopt hook, replace show-more-only button with toggle.
- `web/src/components/workspace/CargoDefaults.tsx` — paginate 任务上下文 list.
- `web/src/components/workspace/TaskCard.tsx` — add `onOpenContext` prop + expanded-block icon.
- `web/src/components/workspace/Kanban.tsx` — accept + forward `onOpenContext`.
- `web/src/pages/ProjectWorkspace.tsx` — supply `onOpenContext` to `<Kanban>`.

---

## Task 1: `useShowMore` hook + `ShowMoreToggle` button

**Files:**
- Modify: `web/src/lib/paging.ts`
- Create: `web/src/components/ui/ShowMoreToggle.tsx`

- [ ] **Step 1: Add the hook to `paging.ts`**

Replace the entire contents of `web/src/lib/paging.ts` with:

```ts
import { useState } from 'react'

export const SESSION_SHOW_MORE_PAGE = 8

/**
 * Client-side "show more / show less" pagination over a flat list of length `total`.
 * `initial` is the collapsed cap (defaults to one page). "more" reveals one more `page`
 * (capped at `total`); once nothing is hidden, the same action ("less") resets to `initial`.
 *
 *   const { visibleCount, hidden, paginated, expanded, toggle } = useShowMore(rows.length)
 *   rows.slice(0, visibleCount)
 *   {paginated && <ShowMoreToggle hidden={hidden} total={rows.length} expanded={expanded} onToggle={toggle} />}
 */
export function useShowMore(
  total: number,
  initial = SESSION_SHOW_MORE_PAGE,
  page = SESSION_SHOW_MORE_PAGE,
) {
  const [shown, setShown] = useState(initial)
  const visibleCount = Math.min(shown, total)
  const hidden = total - visibleCount
  const paginated = total > initial
  const expanded = hidden === 0 && shown > initial
  const toggle = () => setShown((v) => (total - Math.min(v, total) > 0 ? Math.min(v + page, total) : initial))
  return { visibleCount, hidden, paginated, expanded, toggle }
}
```

- [ ] **Step 2: Create the `ShowMoreToggle` button**

Create `web/src/components/ui/ShowMoreToggle.tsx`:

```tsx
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared "展开更多 (N) / 收起" toggle. Pure presentation — pair with useShowMore().
 * `showTotal` appends "/ 共 M" (used by the import dialog). `className` lets each call site
 * keep its own inset/spacing. stopPropagation is guarded so it is safe inside click-to-expand
 * subtrees (e.g. TaskCard) and dialogs alike.
 */
export function ShowMoreToggle({
  hidden,
  total,
  expanded,
  onToggle,
  className,
  showTotal,
}: {
  hidden: number
  total: number
  expanded: boolean
  onToggle: () => void
  className?: string
  showTotal?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'flex items-center gap-1 text-left text-[11px] font-medium text-text-dim hover:text-brand',
        className,
      )}
    >
      <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
      {hidden > 0 ? `展开更多 (${hidden}${showTotal ? ` / 共 ${total}` : ''})` : '收起'}
    </button>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean (no errors). The new exports are unused so far — that is fine (no unused-export lint gate here).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/paging.ts web/src/components/ui/ShowMoreToggle.tsx
git commit -m "feat(web): shared useShowMore hook + ShowMoreToggle button"
```

---

## Task 2: Refactor `SessionModule` Section to the hook

**Files:**
- Modify: `web/src/components/workspace/SessionModule.tsx:372-376, 474-485`

- [ ] **Step 1: Add imports**

In `web/src/components/workspace/SessionModule.tsx`, find the existing import:

```tsx
import { SESSION_SHOW_MORE_PAGE } from '@/lib/paging'
```

Replace it with:

```tsx
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
```

(If `SESSION_SHOW_MORE_PAGE` is referenced elsewhere in this file, keep it in the import list: `import { SESSION_SHOW_MORE_PAGE, useShowMore } from '@/lib/paging'`. Verify with a search before editing.)

- [ ] **Step 2: Replace the pagination state**

Replace these lines (currently `SessionModule.tsx:373-376`):

```tsx
  const [shown, setShown] = useState(limit ?? rows.length)
  const limited = limit != null && rows.length > limit
  const visible = limited ? rows.slice(0, shown) : rows
  const hidden = rows.length - visible.length
```

with:

```tsx
  const { visibleCount, hidden, expanded, toggle } = useShowMore(rows.length, limit ?? rows.length)
  const limited = limit != null && rows.length > limit
  const visible = limited ? rows.slice(0, visibleCount) : rows
```

- [ ] **Step 3: Replace the toggle button**

Replace the button block (currently `SessionModule.tsx:474-485`):

```tsx
          {limited && (
            <button
              onClick={() => {
                if (hidden > 0) setShown((v) => Math.min(v + SESSION_SHOW_MORE_PAGE, rows.length))
                else setShown(limit)
              }}
              className="ml-[38px] flex items-center gap-1 py-1.5 text-left text-[11px] font-medium text-text-dim hover:text-muted-foreground"
            >
              <ChevronDown size={12} />
              {hidden > 0 ? `Show more (${hidden})` : 'Show less'}
            </button>
          )}
```

with:

```tsx
          {limited && (
            <ShowMoreToggle
              hidden={hidden}
              total={rows.length}
              expanded={expanded}
              onToggle={toggle}
              className="ml-[38px] py-1.5"
            />
          )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean. If `ChevronDown` is now unused in this file, remove it from the lucide-react import to satisfy `noUnusedLocals` (search the file first — it is used in the section header at `SessionModule.tsx:388`, so it should stay).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/workspace/SessionModule.tsx
git commit -m "refactor(web): SessionModule Section uses useShowMore/ShowMoreToggle"
```

---

## Task 3: Refactor `Unassigned` SessionGroup to the hook

**Files:**
- Modify: `web/src/pages/Unassigned.tsx:386-390, 418-428`

- [ ] **Step 1: Add imports**

In `web/src/pages/Unassigned.tsx`, find the existing import of `SESSION_SHOW_MORE_PAGE`:

```tsx
import { SESSION_SHOW_MORE_PAGE } from '@/lib/paging'
```

Replace with:

```tsx
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
```

(If `SESSION_SHOW_MORE_PAGE` is used elsewhere in the file, keep it: `import { SESSION_SHOW_MORE_PAGE, useShowMore } from '@/lib/paging'`. Search first.)

- [ ] **Step 2: Replace the pagination state**

Replace these lines (currently `Unassigned.tsx:386-390`):

```tsx
  const LIMIT = 4
  const [shown, setShown] = useState(LIMIT)
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, shown)
  const hidden = sessions.length - visible.length
```

with:

```tsx
  const LIMIT = 4
  const { visibleCount, hidden, expanded, toggle } = useShowMore(sessions.length, LIMIT)
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, visibleCount)
```

- [ ] **Step 3: Replace the toggle button**

Replace the button block (currently `Unassigned.tsx:418-428`):

```tsx
          {sessions.length > LIMIT && (
            <button
              onClick={() => {
                if (hidden > 0) setShown((v) => Math.min(v + SESSION_SHOW_MORE_PAGE, sessions.length))
                else setShown(LIMIT)
              }}
              className="px-3 py-1 pl-[34px] text-left text-[11px] font-medium text-text-dim hover:text-brand"
            >
              {hidden > 0 ? `展开更多 (${hidden})` : '收起'}
            </button>
          )}
```

with:

```tsx
          {sessions.length > LIMIT && (
            <ShowMoreToggle
              hidden={hidden}
              total={sessions.length}
              expanded={expanded}
              onToggle={toggle}
              className="px-3 py-1 pl-[34px]"
            />
          )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean. Remove any now-unused imports (e.g. `useState` only if nothing else in the file uses it — search first; `ChevronDown`/`ChevronRight` are used in the header at `Unassigned.tsx:397`, keep them).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Unassigned.tsx
git commit -m "refactor(web): Unassigned SessionGroup uses useShowMore/ShowMoreToggle"
```

---

## Task 4: `ImportDialog` — adopt hook, add show-less

**Files:**
- Modify: `web/src/components/ImportDialog.tsx:1-6, 40, 43-44, 106-113`

- [ ] **Step 1: Update imports**

In `web/src/components/ImportDialog.tsx`, replace:

```tsx
import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Dialog } from '@/components/ui/Overlay'
import { SessionPickRow } from '@/components/SessionPickRow'
import { SESSION_SHOW_MORE_PAGE } from '@/lib/paging'
import type { PreviewSession } from '@/lib/api'
```

with:

```tsx
import { useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Overlay'
import { SessionPickRow } from '@/components/SessionPickRow'
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
import type { PreviewSession } from '@/lib/api'
```

(`useState` stays — it is still used for `checked` and `register`. `ChevronDown` moves into `ShowMoreToggle`.)

- [ ] **Step 2: Replace the pagination state**

Replace this line (currently `ImportDialog.tsx:40`):

```tsx
  const [shown, setShown] = useState(SESSION_SHOW_MORE_PAGE)
```

with:

```tsx
  const { visibleCount, hidden, paginated, expanded, toggle } = useShowMore(sessions.length)
```

Then replace these lines (currently `ImportDialog.tsx:43-44`):

```tsx
  const visible = sessions.slice(0, shown)
  const hidden = sessions.length - visible.length
```

with:

```tsx
  const visible = sessions.slice(0, visibleCount)
```

- [ ] **Step 3: Replace the show-more-only button with the toggle**

Replace the button block (currently `ImportDialog.tsx:106-113`):

```tsx
                {hidden > 0 && (
                  <button
                    onClick={() => setShown((v) => v + SESSION_SHOW_MORE_PAGE)}
                    className="mt-1 flex items-center gap-1 px-1 py-1 text-left text-[11px] font-medium text-text-dim hover:text-brand"
                  >
                    <ChevronDown size={12} /> Show more（再展开 {Math.min(SESSION_SHOW_MORE_PAGE, hidden)} / 共 {sessions.length}）
                  </button>
                )}
```

with:

```tsx
                {paginated && (
                  <ShowMoreToggle
                    hidden={hidden}
                    total={sessions.length}
                    expanded={expanded}
                    onToggle={toggle}
                    showTotal
                    className="mt-1 px-1 py-1"
                  />
                )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ImportDialog.tsx
git commit -m "feat(web): ImportDialog show-more now collapses (show-less)"
```

---

## Task 5: `CargoDefaults` — paginate 任务上下文 list

**Files:**
- Modify: `web/src/components/workspace/CargoDefaults.tsx:1, 62, 137-151`

- [ ] **Step 1: Add imports**

In `web/src/components/workspace/CargoDefaults.tsx`, add to the top imports (after the existing `import { ImportDialog } …` line):

```tsx
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
```

- [ ] **Step 2: Add the hook call**

Immediately after this line (currently `CargoDefaults.tsx:62`):

```tsx
  const [tasksOpen, setTasksOpen] = useState(false)
```

add:

```tsx
  const taskPaging = useShowMore(tasks.length)
```

- [ ] **Step 3: Slice the list and add the toggle**

Replace the inner expanded block (currently `CargoDefaults.tsx:137-149`):

```tsx
              {tasksOpen && (
                <div className="mt-1 flex flex-col gap-1.5 pl-1.5">
                  {tasks.map((t) => (
                    <button
                      key={t.id}
                      className="text-left"
                      onClick={() => onOpenDoc?.({ kind: 'task', key: t.id, path: `tasks/${t.id}/index.md`, title: `任务上下文 · ${t.title}` })}
                    >
                      <RegRow icon={FileText} name={t.title} sub={`tasks/${t.id}/index.md`} />
                    </button>
                  ))}
                </div>
              )}
```

with:

```tsx
              {tasksOpen && (
                <div className="mt-1 flex flex-col gap-1.5 pl-1.5">
                  {tasks.slice(0, taskPaging.visibleCount).map((t) => (
                    <button
                      key={t.id}
                      className="text-left"
                      onClick={() => onOpenDoc?.({ kind: 'task', key: t.id, path: `tasks/${t.id}/index.md`, title: `任务上下文 · ${t.title}` })}
                    >
                      <RegRow icon={FileText} name={t.title} sub={`tasks/${t.id}/index.md`} />
                    </button>
                  ))}
                  {taskPaging.paginated && (
                    <ShowMoreToggle
                      hidden={taskPaging.hidden}
                      total={tasks.length}
                      expanded={taskPaging.expanded}
                      onToggle={taskPaging.toggle}
                      className="px-1 py-0.5"
                    />
                  )}
                </div>
              )}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/workspace/CargoDefaults.tsx
git commit -m "feat(web): paginate 任务上下文 list with show-more/show-less"
```

---

## Task 6: `TaskCard` context icon + thread `onOpenContext`

**Files:**
- Modify: `web/src/components/workspace/TaskCard.tsx:2, 139-147, 149-168, 330-342`
- Modify: `web/src/components/workspace/Kanban.tsx:12-35, 112-128`
- Modify: `web/src/pages/ProjectWorkspace.tsx:553-565`

- [ ] **Step 1: Add `FileText` to TaskCard's lucide import**

In `web/src/components/workspace/TaskCard.tsx`, the icon import (line 2) is:

```tsx
import { Play, ChevronDown, ChevronRight, Link2, MoreHorizontal, CalendarClock, Sparkles, Trash2, Loader2 } from 'lucide-react'
```

Add `FileText`:

```tsx
import { Play, ChevronDown, ChevronRight, Link2, MoreHorizontal, CalendarClock, Sparkles, Trash2, Loader2, FileText } from 'lucide-react'
```

- [ ] **Step 2: Add the `onOpenContext` prop**

Add the callback to the `MenuActions` type (currently `TaskCard.tsx:139-147`). Append a line before the closing brace:

```tsx
type MenuActions = {
  onSetStatus?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onSetDdl?: (taskId: string, ddl: string | null) => void
  onRename?: (taskId: string, title: string) => void
  onGenerateTitle?: (taskId: string) => void
  titleGenerating?: boolean
  onDelete?: (taskId: string) => void
  onOpenContext?: (task: Task) => void
}
```

Then destructure it in the `TaskCard` signature. Currently (`TaskCard.tsx:149-168`) the params list ends with `onDelete,` before the type annotation. Add `onOpenContext,` to the destructure:

```tsx
export function TaskCard({
  task,
  active,
  onLaunch,
  onOpenSession,
  onActivate,
  onSetStatus,
  onSetPriority,
  onSetDdl,
  onRename,
  onGenerateTitle,
  titleGenerating,
  onDelete,
  onOpenContext,
}: {
  task: Task
  active: boolean
  onLaunch?: (taskId: string) => void
  onOpenSession?: (link: LinkedSession) => void
  onActivate?: () => void
} & MenuActions) {
```

- [ ] **Step 3: Render the icon in the expanded block's 进展摘要 label row**

In the expanded block, the 进展摘要 label currently renders as a bare `<ExpLabel>进展摘要</ExpLabel>` in two branches (`TaskCard.tsx:334` and `:341`). Replace **both** occurrences of:

```tsx
              <ExpLabel>进展摘要</ExpLabel>
```

with a flex row that pushes a context icon to the right:

```tsx
              <div className="mb-1 flex items-center gap-2">
                <ExpLabel className="mb-0">进展摘要</ExpLabel>
                <span className="flex-1" />
                {onOpenContext && (
                  <button
                    type="button"
                    title="打开任务上下文"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenContext(task)
                    }}
                    className="flex-none rounded p-0.5 text-text-dim hover:bg-secondary hover:text-brand"
                  >
                    <FileText size={13} />
                  </button>
                )}
              </div>
```

Note: `ExpLabel` already accepts a `className` (see `TaskCard.tsx:423`), and `mb-0` cancels its default bottom margin so the row controls spacing.

Edge case — a live card with **no summary yet** shows a "生成进展小结" button instead of a 进展摘要 label (`TaskCard.tsx:354-366`); that branch has no label row. To keep the context icon reachable there too, add it just inside the top of the expanded block. Right after the opening line of the expanded block (currently `TaskCard.tsx:331`):

```tsx
        <div className="border-t border-border bg-brand/[0.04] px-[13px] py-2.5">
```

insert, as the first child, a right-aligned icon **only when there is no summary and not summarizing** (so it doesn't duplicate the one in the label row):

```tsx
          {onOpenContext && !task.summary && !task.summarizing && (
            <div className="mb-1.5 flex">
              <span className="flex-1" />
              <button
                type="button"
                title="打开任务上下文"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenContext(task)
                }}
                className="flex-none rounded p-0.5 text-text-dim hover:bg-secondary hover:text-brand"
              >
                <FileText size={13} />
              </button>
            </div>
          )}
```

- [ ] **Step 4: Forward `onOpenContext` through `Kanban`**

In `web/src/components/workspace/Kanban.tsx`, add the prop to the destructure (currently ends with `onCreateTask,` at line 23) and its type (currently `onCreateTask?: () => void` at line 35):

Destructure — add `onOpenContext,` after `onDelete,`:

```tsx
  onDelete,
  onOpenContext,
  onCreateTask,
}: {
```

Type — add the line after `onDelete?: (taskId: string) => void`:

```tsx
  onDelete?: (taskId: string) => void
  onOpenContext?: (task: Task) => void
  onCreateTask?: () => void
}) {
```

(`Task` is already imported in Kanban at line 6.)

Then pass it to each `<TaskCard>` (currently `Kanban.tsx:113-127`). Add `onOpenContext={onOpenContext}` before the closing `/>`:

```tsx
                  <TaskCard
                    key={t.id}
                    task={t}
                    active={isActive}
                    onLaunch={onLaunch}
                    onOpenSession={onOpenSession}
                    onActivate={() => setActive(status)}
                    onSetStatus={onMove}
                    onSetPriority={onSetPriority}
                    onSetDdl={onSetDdl}
                    onRename={onRename}
                    onGenerateTitle={onGenerateTitle}
                    titleGenerating={titleGeneratingIds?.has(t.id)}
                    onDelete={onDelete}
                    onOpenContext={onOpenContext}
                  />
```

- [ ] **Step 5: Supply `onOpenContext` from `ProjectWorkspace`**

In `web/src/pages/ProjectWorkspace.tsx`, the `<Kanban>` element (currently `:553-565`) ends with `onCreateTask={() => setNewTask(true)}`. Add the handler that reuses the existing `setCtxDoc` (same shape `CargoDefaults` feeds it):

```tsx
          <Kanban
            tasks={boardTasks}
            onLaunch={launch}
            onOpenSession={openLinkedSession}
            onMove={onMove}
            onSetPriority={onSetPriority}
            onSetDdl={onSetDdl}
            onRename={onRename}
            onGenerateTitle={onGenerateTaskTitle}
            titleGeneratingIds={titleGeneratingIds}
            onDelete={onDelete}
            onOpenContext={(t) =>
              setCtxDoc({ kind: 'task', key: t.id, path: `tasks/${t.id}/index.md`, title: `任务上下文 · ${t.title}` })
            }
            onCreateTask={() => setNewTask(true)}
          />
```

`boardTasks` items are `Task` objects (they carry `id` and `title`), so `t.id` / `t.title` are valid. `setCtxDoc` and `ContextDocDrawer` already exist (`ProjectWorkspace.tsx:39, 604`) — no new state.

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/workspace/TaskCard.tsx web/src/components/workspace/Kanban.tsx web/src/pages/ProjectWorkspace.tsx
git commit -m "feat(web): open task context doc from an expanded task card"
```

---

## Task 7: Full verification

- [ ] **Step 1: Web typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Root typecheck**

Run: `npx tsc --noEmit` (from repo root)
Expected: clean (backend untouched, should already pass).

- [ ] **Step 3: Unit tests**

Run: `npm test`
Expected: green (these changes don't touch tested code paths).

- [ ] **Step 4: Manual app check**

Run the app (`npm start`, or the project's run skill) and confirm:
1. A project with **>8 tasks**: open 默认装载 → 任务上下文 → list shows 8 rows + `展开更多 (N)`; clicking grows by 8; when fully expanded the button reads `收起` and collapses back to 8.
2. **Import dialog** with >8 sessions (添加目录 on a dir with many sessions): shows `展开更多 (N / 共 M)`; fully expanded shows `收起` and collapses.
3. **Expanded task card**: a `FileText` icon appears (top-right of the 进展摘要 area, and on a no-summary live card); clicking opens the context drawer at `tasks/<id>/index.md` without toggling/collapsing the card.
4. **Session lists** (project SessionModule cwd groups, 无归属 page groups) still paginate and now read `展开更多`/`收起`.

- [ ] **Step 5: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "fix(web): show-more/show-less + task-context polish from manual check"
```

(Skip if nothing changed in step 4.)

---

## Self-review notes

- **Spec coverage:** §1 list pagination → Task 5; §2 show-less everywhere → Tasks 2/3 (already-toggling sites refactored), 4 (ImportDialog gains show-less), 5; §3 task-card entry → Task 6; shared hook → Task 1 + adopted in Tasks 2–5. All spec sections mapped.
- **Type consistency:** hook returns `{ visibleCount, hidden, paginated, expanded, toggle }` — same names used in every call site; `onOpenContext?: (task: Task) => void` identical in `MenuActions`, `Kanban` props, and the `ProjectWorkspace` callsite.
- **No placeholders:** every code step shows full before/after blocks; verification is concrete commands.
- **Behavior note:** `SessionModule`'s label text changes from English `Show more/Show less` to Chinese `展开更多/收起` — intentional consistency change per spec.
```
