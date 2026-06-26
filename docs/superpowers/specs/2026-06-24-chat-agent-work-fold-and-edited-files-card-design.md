# Chat: agent-work fold + Edited-files card — design

Date: 2026-06-24
Branch: `release/berth-2.0-ia`
Scope: frontend only (`web/`). No backend, type-model, or payload changes.

## Problem

In the Berth 2.0 chat view, one agent run renders as **many separate bubbles** — every
`reasoning`, `tool_call`, and intermediate `text` block becomes its own bubble
(`ChatTranscript.tsx`, the `turn.blocks.map(...)` at line 52). The user wants the
Claude.ai / ChatGPT shape instead:

1. **A collapsible "agent work" block** per assistant turn — folded state shows
   `Worked for Ns · N 步`; expanded state shows the steps inline.
2. **An "Edited files" card** summarizing file changes (`Edited N files +A -R`, one row per
   file, each row expandable to a red/green diff) — the artifact card Berth currently lacks.

## Non-goals

- No backend / reducer / `chat-model.ts` type changes.
- No new payload fields or replay-jsonl format change.
- Not replacing the in-fold tool_call detail — the card is an additional summary.

## Context (current architecture)

- `web/src/components/ChatTranscript.tsx` — presentational renderer. `AssistantTurn`
  iterates `turn.blocks` and renders each via `BlockView` (text bubble / reasoning
  `<details>` / tool_call `<details>`). `TurnFooter` shows `Worked for Ns · tok`.
- `web/src/lib/chat.ts` — `Block` union (`text` | `reasoning` | `tool_call`), `ChatTurn`
  (`blocks: Block[]`, `streaming?`, `result?: { durationMs, usage, isError, errorSubtype }`).
- `web/src/lib/useChatSession.ts` — WS stream; `applyChatFrame` upserts turns.
- Tool calls already carry `input: unknown` straight from the CLI; the frontend **already**
  inspects CLI-specific input shapes (`summarizeInput` reads `o.command ?? o.file_path ?? …`
  at `ChatTranscript.tsx:116`). Computing edits from `input` on the frontend is consistent
  with this existing pattern.

The backend stays the "dumb-renderer feeder"; both features are pure view logic over the
`ChatTurn[]` already received.

---

## Feature 1: agent-work fold

### Split rule

For an assistant turn, partition `blocks` into:

- **answer** = the trailing contiguous run of `text` blocks (the final reply).
- **work** = everything before that run (`reasoning`, `tool_call`, and any *intermediate*
  `text` narration).

Rationale: matches the screenshots — intermediate narration folds away, only the final
answer stays outside the fold. Implemented by scanning from the end while `block.kind ===
'text'`; the first non-text block (from the end) marks the answer boundary.

Edge cases:
- **Pure-text turn** (no work blocks): render the answer normally with the existing small
  `Worked for Ns` footer — **no empty disclosure**.
- **Work-only turn** (no trailing text, e.g. still mid-tool): render the fold, no answer
  region yet.

### Folded vs expanded

A single disclosure (the work block) with header + body:

- **Header (folded state), always visible:**
  - done → `Worked for {secs}s · {n} 步` (+ ` · {tok} tok` when `result.usage.output`).
  - streaming → `工作中… · {n} 步`.
  - interrupted → `已中断{ (subtype)}` (from `result.isError` / `errorSubtype`).
  - `secs` from `result.durationMs` (reusing `TurnFooter`'s formatting); `n` = count of
    `tool_call` blocks in the work partition.
- **Body (expanded state):** the work blocks rendered via the existing `BlockView`
  (reasoning chip / tool `<details>` / text bubble), indented under a left border.

### Open/close behavior

`open = userOverride ?? !!turn.streaming` — defaults expanded while streaming, auto-collapses
on completion (when `durationMs`/non-streaming arrives), and once the user clicks the chevron
their choice (`userOverride`) sticks. Chevron via lucide `ChevronRight` with
`rotate-90 when open` (the rotation pattern already used in the codebase).

When the turn is a pure-text turn, there is no chevron — just the answer + footer.

### Replaces

The `turn.blocks.map(...)` body of `AssistantTurn` (lines 50-58) becomes:
`work-fold (if any) + answer bubbles + EditedFilesCard (if any) + footer-or-header-merged`.
The standalone `TurnFooter` duration text is merged into the fold header for turns that have a
fold; pure-text turns keep `TurnFooter` as-is.

---

## Feature 2: Edited-files card

Always visible in the **answer region** (outside the fold), below the final answer text —
matching the Claude.ai artifact card. The same tool_calls still appear inside the fold; the
card is a summary view, not a replacement.

### New module: `web/src/lib/fileEdits.ts`

```ts
export interface DiffLine { op: ' ' | '+' | '-'; text: string }
export interface FileEdit {
  path: string
  op: 'edit' | 'add' | 'delete'
  added: number
  removed: number
  hunks: DiffLine[]      // for the expandable diff; may be capped
  truncated: boolean     // true when hunks were capped
}

// LCS line diff → counts + hunks, capped at MAX_DIFF_LINES (e.g. 400) → truncated:true
export function lineDiff(before: string, after: string): { added: number; removed: number; hunks: DiffLine[]; truncated: boolean }

// Per-CLI adapter: (tool name, input) → raw per-file before/after pairs
//   claude: Edit {file_path, old_string, new_string}
//           MultiEdit {file_path, edits:[{old_string,new_string}]}  (apply sequentially)
//           Write {file_path, content}                              → op:'add', before:''
//           NotebookEdit {notebook_path, new_source, edit_mode}     → best-effort
//   codex:  file_change {changes}  → best-effort parse; unknown shape ⇒ path-only fallback
// Returns [] for non-editing tools (Bash/Read/Grep/…).
export function fileEditsFromTool(name: string, input: unknown): FileEdit[]

// Aggregate across a turn's tool_call blocks, dedup by path (sum added/removed,
// concat hunks in call order). Memoize by turn identity at the call site.
export function fileEditsFromTurn(turn: ChatTurn): FileEdit[]
```

Adapter notes:
- **MultiEdit**: apply edits sequentially to reconstruct before/after, so counts reflect the
  net change for that file (one `FileEdit` per file).
- **Write**: `op:'add'`, `before:''` → all `content` lines counted as added. (We don't know the
  prior file contents; this is the documented approximation, accurate for new files.)
- **codex `file_change`**: `input.changes` shape is unconfirmed (no fixture; codex can't be run
  in this env). Parse the plausible shapes (a `path → {unified diff | added/removed | content}`
  map); on any unrecognized shape, emit `{path, op:'edit', added:0, removed:0, hunks:[],
  truncated:false}` so the row shows the file name without fabricated numbers and is not
  expandable. **claude is fully accurate**; codex counts may need a one-line adapter fix after
  a live codex run.

### Component: `EditedFilesCard` (in `ChatTranscript.tsx`)

```
┌ Edited 2 files                                  +19 -3 ┐
│  web/src/components/workspace/Kanban.tsx       +18 -3 ▸│  ← click row → inline diff
│  web/src/pages/ProjectWorkspace.tsx            +1  -0  │
└───────────────────────────────────────────────────────┘
```

- Header: `Edited {files.length} file(s)` + total `+{ΣA} -{ΣR}` (green `+`, red `-`).
- Row: basename emphasized + dimmed dir prefix, right-aligned `+a -r`, chevron when `hunks`
  present.
- Expanded row: red/green diff from `hunks`; if `truncated`, show a `diff 已截断` note. Rows
  with empty `hunks` (codex fallback) are not expandable.
- Render the card only when `fileEditsFromTurn(turn).length > 0`.
- Styling reuses existing tokens (`bg-card`, `border-border`, `text-success`/`text-destructive`,
  `text-[11px]`, `ChevronRight` + `rotate-90`).

---

## Testing

- `web` unit tests (vitest) for `web/src/lib/fileEdits.ts`:
  - `lineDiff`: pure add, pure remove, mixed, identical (0/0), truncation cap.
  - `fileEditsFromTool`: claude `Edit`, `MultiEdit` (sequential), `Write` (op:'add'); a
    non-editing tool → `[]`; codex unknown shape → path-only fallback.
  - `fileEditsFromTurn`: dedup-by-path summation across multiple tool_calls.
- Manual/visual: fold collapse-on-complete + user override; card with 1 and N files; an empty
  edits turn (no card); a pure-text turn (no fold).
- Gates: `npx tsc --noEmit` (root) · `npm test` (root) · `web` typecheck (`web/npm run
  typecheck`) · `web` build. Commit on `release/berth-2.0-ia` when green.

## Risks

- **codex `file_change.changes` shape** — only confirmed risk; mitigated by graceful
  path-only fallback and isolated to one adapter function. Flag for a follow-up fixture once a
  real codex file-edit session is available.
- **Answer-boundary heuristic** — "trailing text run = answer" could fold a turn that ends on a
  tool call (no answer yet); handled by the work-only edge case (render fold, no answer region).
