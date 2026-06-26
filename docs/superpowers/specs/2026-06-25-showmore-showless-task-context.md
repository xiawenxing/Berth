# Show-more / show-less consistency + task-card context entry

Date: 2026-06-25
Branch: `release/berth-2.0-ia`
Scope: `web/` (Berth 2.0 React SPA) only. No backend changes.

## Problem

Three gaps in the current list/expand UX:

1. **任务上下文 list has no pagination.** In `CargoDefaults` the 任务上下文 list
   (`web/src/components/workspace/CargoDefaults.tsx:137-151`) renders **all** registered
   tasks at once when expanded. A project with many tasks produces an unbounded list.
2. **One show-more site lacks show-less.** `ImportDialog`
   (`web/src/components/ImportDialog.tsx:106-113`) only grows `shown`; there is no way to
   collapse back. `SessionModule` and `Unassigned` already toggle correctly, so the app is
   inconsistent.
3. **No way to open a task's context doc from its card.** When a `TaskCard` is expanded
   there is no entry point to the task's context document (`tasks/<id>/index.md`). That doc
   is only reachable from the `CargoDefaults` 任务上下文 list.

## Goals

- The 任务上下文 list paginates with a show-more **and** show-less toggle.
- Every show-more site in the app has a matching show-less (collapse to initial state).
- An expanded task card exposes an icon button that opens the task's context doc in the
  existing `ContextDocDrawer`.
- Show-more/show-less logic lives in **one shared hook**, adopted by all four sites, so the
  behavior can't diverge again.

Non-goals: no backend/API changes; no new context drawer (reuse `ContextDocDrawer`); no
change to how context docs are generated or stored.

## Decisions (confirmed with owner)

- **Batch size:** reuse the existing `SESSION_SHOW_MORE_PAGE = 8` (initial 8, +8 per click)
  for the 任务上下文 list.
- **Task-card entry:** an **icon button inside the expanded block** (a `FileText` icon near
  the 进展摘要 label row), not a full-width labeled row or a footer chip.
- **Shared hook:** extract one `useShowMore` hook and refactor **all four** sites to use it
  (including the already-working `SessionModule` and `Unassigned`).

## Design

### 1. Shared `useShowMore` hook + `ShowMoreToggle` button

Add to `web/src/lib/paging.ts` (keep the existing `SESSION_SHOW_MORE_PAGE` export):

```ts
import { useState } from 'react'

export const SESSION_SHOW_MORE_PAGE = 8

/**
 * Client-side "show more / show less" pagination over a flat list.
 * `initial` is the collapsed cap (defaults to one page). Each "more" reveals
 * one more page (capped at `total`); once nothing is hidden, "less" resets to `initial`.
 */
export function useShowMore(total: number, initial = SESSION_SHOW_MORE_PAGE, page = SESSION_SHOW_MORE_PAGE) {
  const [shown, setShown] = useState(initial)
  const visibleCount = Math.min(shown, total)
  const hidden = total - visibleCount
  const paginated = total > initial      // is the list big enough to need a toggle at all
  const toggle = () => setShown((v) => (hidden > 0 ? Math.min(v + page, total) : initial))
  return { visibleCount, hidden, paginated, expanded: hidden === 0 && shown > initial, toggle }
}
```

- Call sites slice with `list.slice(0, visibleCount)`.
- `paginated` gates whether the toggle button renders.
- `toggle` is the single more↔less action: grow by a page, or (when fully expanded) snap
  back to `initial`.

Presentational button, same file or `web/src/components/ui/` — a small `ShowMoreToggle`:

```tsx
function ShowMoreToggle({ hidden, total, expanded, onToggle, className, showTotal }: {
  hidden: number; total: number; expanded: boolean; onToggle: () => void
  className?: string; showTotal?: boolean
}) {
  return (
    <button onClick={(e) => { e.stopPropagation?.(); onToggle() }} className={cn(/* shared muted style */, className)}>
      <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
      {hidden > 0
        ? `展开更多 (${hidden}${showTotal ? ` / 共 ${total}` : ''})`
        : '收起'}
    </button>
  )
}
```

- **Label is unified to Chinese** `展开更多 (N)` / `收起` across all four sites (the app is
  Chinese-first). `showTotal` appends `/ 共 M` for the `ImportDialog` case, which currently
  surfaces the total count.
- `className` lets each call site keep its existing indentation/spacing (e.g. the
  `ml-[38px]` / `pl-[34px]` insets in the session lists).
- `stopPropagation` is guarded so the button is safe inside the click-to-expand `TaskCard`
  subtree and inside dialogs alike.

### 2. `CargoDefaults` 任务上下文 list (`CargoDefaults.tsx`)

- Call `useShowMore(tasks.length)` in the component.
- When `tasksOpen`, map over `tasks.slice(0, visibleCount)` instead of all `tasks`.
- After the mapped rows, render `<ShowMoreToggle>` when `paginated` is true, indented to
  match the `pl-1.5` task rows.
- The outer chevron toggle (`tasksOpen`) and count badge are unchanged.

### 3. `ImportDialog` (`ImportDialog.tsx`)

- Replace the local `shown`/`setShown` (`ImportDialog.tsx:40`) with `useShowMore(sessions.length)`.
- Slice `sessions.slice(0, visibleCount)`.
- Replace the show-more-only button (`ImportDialog.tsx:106-113`) with `<ShowMoreToggle ...
  showTotal />` so it now also collapses. Keep it gated on `paginated`.

### 4. `SessionModule` Section + `Unassigned` SessionGroup (refactor to hook)

Both already implement the toggle inline. Refactor each to `useShowMore` and `ShowMoreToggle`:

- `SessionModule.tsx` `Section`: `limit`-based; pass `useShowMore(rows.length, limit ?? rows.length)`.
  Preserve current behavior — the toggle only appears when a `limit` is set and exceeded
  (keep the existing `limited` guard alongside `paginated`). Keep the `ml-[38px]` inset via
  `className`.
- `Unassigned.tsx` `SessionGroup`: `LIMIT = 4`; `useShowMore(sessions.length, LIMIT)`. Keep
  the `pl-[34px]` inset via `className`.

These two are visible-behavior-equivalent after refactor (the label text changes to the
unified `展开更多 (N)` / `收起`, which already matches `Unassigned`'s current wording;
`SessionModule`'s English `Show more`/`Show less` becomes Chinese — an intentional
consistency change).

### 5. `TaskCard` context-doc icon (`TaskCard.tsx` + `Kanban.tsx` + `ProjectWorkspace`)

- Add an optional prop to `TaskCard`: `onOpenContext?: (task: Task) => void` (added to the
  `MenuActions`/props type). 
- In the expanded block (`open && …`, near the 进展摘要 `ExpLabel` at `TaskCard.tsx:330-342`),
  render a `FileText` icon button — `title="打开任务上下文"` — **only when `onOpenContext` is
  provided**. On click: `e.stopPropagation(); onOpenContext(task)`. Placed at the right edge
  of the 进展摘要 label row (the label row becomes a flex row with the icon pushed right).
- Thread the handler:
  - `Kanban` (`web/src/components/workspace/Kanban.tsx:113-127`) accepts and forwards an
    `onOpenContext` prop to each `<TaskCard>`.
  - `ProjectWorkspace` (which owns `setCtxDoc` and renders `<ContextDocDrawer target={ctxDoc}>`)
    passes:
    ```tsx
    onOpenContext={(t) => setCtxDoc({
      kind: 'task', key: t.id,
      path: `tasks/${t.id}/index.md`,
      title: `任务上下文 · ${t.title}`,
    })}
    ```
    This is the exact shape `CargoDefaults` already feeds `onOpenDoc`/`setCtxDoc`.
- `TaskCard`'s other usages (`Rail`, `SessionTitleBar`) pass no `onOpenContext`, so the icon
  does not appear there — no wiring needed for them.

## Data flow

```
ProjectWorkspace (owns ctxDoc state + ContextDocDrawer)
  ├─ CargoDefaults  onOpenDoc=setCtxDoc          (existing — task/project docs)
  └─ Kanban         onOpenContext=(t)=>setCtxDoc(...)   (new)
        └─ TaskCard  onOpenContext  → FileText icon in expanded block
ContextDocDrawer target={ctxDoc}                  (existing — unchanged, reused)
```

## Error handling / edge cases

- Lists with `total <= initial` (≤8, or ≤`limit`) render no toggle (`paginated === false`) —
  identical to today.
- Empty task list: 任务上下文 section already hidden by `tasks.length > 0` guard; unchanged.
- `useShowMore` state is per-component-instance; collapsing a project's 任务上下文 list does
  not affect another project's. The `shown` state resets naturally on unmount/remount.
- The `TaskCard` icon stops propagation so it never toggles the card's expand state or starts
  a drag.

## Testing / verification

- `web/` has no component-test harness for these UI pieces; the unit-test suite (`npm test`)
  is backend/CLI-focused. Verification gate:
  - `cd web && npx tsc --noEmit` clean (project also runs root `npx tsc --noEmit`).
  - `npm test` green (must stay green; these changes shouldn't touch tested code paths).
  - Manual check in the running app: (a) a project with >8 tasks shows 展开更多/收起 on the
    任务上下文 list; (b) the import dialog with >8 sessions now collapses; (c) an expanded
    task card shows the context icon and clicking it opens the doc drawer at
    `tasks/<id>/index.md`; (d) session lists in SessionModule/Unassigned still paginate.

## Files touched

- `web/src/lib/paging.ts` — add `useShowMore` hook (+ `ShowMoreToggle`, or place the button in `ui/`).
- `web/src/components/workspace/CargoDefaults.tsx` — paginate 任务上下文 list.
- `web/src/components/ImportDialog.tsx` — adopt hook, add show-less.
- `web/src/components/workspace/SessionModule.tsx` — refactor Section to hook.
- `web/src/pages/Unassigned.tsx` — refactor SessionGroup to hook.
- `web/src/components/workspace/TaskCard.tsx` — add `onOpenContext` + expanded-block icon.
- `web/src/components/workspace/Kanban.tsx` — forward `onOpenContext`.
- `ProjectWorkspace` (the component rendering `<Kanban>` + `<ContextDocDrawer>`) — supply
  `onOpenContext`.
```
