# Chat agent-work fold + Edited-files card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Berth 2.0 chat view, collapse each agent turn's intermediate work into one `Worked for Ns · N 步` disclosure (final answer stays visible), and add a Claude.ai-style "Edited files" card summarizing per-file `+A -R` with an expandable diff.

**Architecture:** Frontend-only. No backend, `chat-model.ts` type, or payload changes. A new pure module `web/src/lib/fileEdits.ts` derives normalized file edits from the `tool_call` blocks already in each `ChatTurn` (reading the CLI `input` the frontend already receives — the same pattern `summarizeInput` already uses). `web/src/components/ChatTranscript.tsx` gains a `WorkFold` and an `EditedFilesCard`.

**Tech Stack:** React 18 + TypeScript, Tailwind, lucide-react, vitest. `cn` from `@/lib/utils`.

---

## File structure

- **Create** `web/src/lib/fileEdits.ts` — pure logic: `lineDiff`, `fileEditsFromTool`, `fileEditsFromTurn`, types `DiffLine` / `FileEdit`.
- **Create** `web/src/lib/fileEdits.test.ts` — vitest unit tests for the above.
- **Modify** `web/src/components/ChatTranscript.tsx` — add `splitBlocks`, `WorkFold`, `EditedFilesCard`, `EditedFileRow`; rewrite `AssistantTurn`. Keep `prettyToolName` exported (an existing test imports it).

Reference (read before starting): `docs/superpowers/specs/2026-06-24-chat-agent-work-fold-and-edited-files-card-design.md` and the current `web/src/components/ChatTranscript.tsx` / `web/src/lib/chat.ts`.

Commands (run from `web/`): tests `npm test`, typecheck `npm run typecheck`, build `npm run build`.

---

## Task 1: `lineDiff` — LCS line diff with cap

**Files:**
- Create: `web/src/lib/fileEdits.ts`
- Test: `web/src/lib/fileEdits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/fileEdits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lineDiff } from './fileEdits'

describe('lineDiff', () => {
  it('counts pure additions (empty before)', () => {
    const d = lineDiff('', 'a\nb\nc')
    expect(d.added).toBe(3)
    expect(d.removed).toBe(0)
    expect(d.hunks).toEqual([
      { op: '+', text: 'a' },
      { op: '+', text: 'b' },
      { op: '+', text: 'c' },
    ])
    expect(d.truncated).toBe(false)
  })

  it('counts pure removals (empty after)', () => {
    const d = lineDiff('a\nb', '')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(2)
  })

  it('counts a mixed edit, keeping context lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.hunks).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
      { op: ' ', text: 'c' },
    ])
  })

  it('reports 0/0 for identical text', () => {
    const d = lineDiff('x\ny', 'x\ny')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
  })

  it('caps hunks and sets truncated', () => {
    const before = ''
    const after = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const d = lineDiff(before, after)
    expect(d.added).toBe(500)
    expect(d.hunks.length).toBe(400)
    expect(d.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npm test -- fileEdits`
Expected: FAIL — `Cannot find module './fileEdits'` / `lineDiff is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/fileEdits.ts`:

```ts
import type { Block, ChatTurn } from './chat'

export interface DiffLine { op: ' ' | '+' | '-'; text: string }

export interface FileEdit {
  path: string
  op: 'edit' | 'add' | 'delete'
  added: number
  removed: number
  hunks: DiffLine[]
  truncated: boolean
}

const MAX_DIFF_LINES = 400

/** Line-level LCS diff → counts + hunks, capped at MAX_DIFF_LINES. */
export function lineDiff(
  before: string,
  after: string,
): { added: number; removed: number; hunks: DiffLine[]; truncated: boolean } {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const hunks: DiffLine[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { hunks.push({ op: ' ', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { hunks.push({ op: '-', text: a[i] }); removed++; i++ }
    else { hunks.push({ op: '+', text: b[j] }); added++; j++ }
  }
  while (i < n) { hunks.push({ op: '-', text: a[i] }); removed++; i++ }
  while (j < m) { hunks.push({ op: '+', text: b[j] }); added++; j++ }
  return capHunks(added, removed, hunks)
}

function capHunks(added: number, removed: number, hunks: DiffLine[]) {
  const truncated = hunks.length > MAX_DIFF_LINES
  return { added, removed, hunks: truncated ? hunks.slice(0, MAX_DIFF_LINES) : hunks, truncated }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
```

(`Block` import and `str`/`capHunks` are used by later tasks; `MAX_DIFF_LINES` and `str` are intentionally referenced ahead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fileEdits`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/fileEdits.ts web/src/lib/fileEdits.test.ts
git commit -m "feat(web): lineDiff LCS helper for file-edit diffs"
```

---

## Task 2: `fileEditsFromTool` — claude adapters + codex best-effort

**Files:**
- Modify: `web/src/lib/fileEdits.ts`
- Test: `web/src/lib/fileEdits.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/fileEdits.test.ts`:

```ts
import { fileEditsFromTool } from './fileEdits'

describe('fileEditsFromTool', () => {
  it('claude Edit → one FileEdit from old/new diff', () => {
    const r = fileEditsFromTool('Edit', { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\nY' })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'a.ts', op: 'edit', added: 1, removed: 1 })
  })

  it('claude MultiEdit → sums edits for one file', () => {
    const r = fileEditsFromTool('MultiEdit', {
      file_path: 'a.ts',
      edits: [
        { old_string: 'a', new_string: 'A' },
        { old_string: 'b\nc', new_string: 'b\nC' },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'a.ts', op: 'edit', added: 2, removed: 2 })
  })

  it('claude Write → op:add, all content lines added', () => {
    const r = fileEditsFromTool('Write', { file_path: 'new.ts', content: 'one\ntwo' })
    expect(r[0]).toMatchObject({ path: 'new.ts', op: 'add', added: 2, removed: 0 })
  })

  it('non-editing tool → []', () => {
    expect(fileEditsFromTool('Bash', { command: 'ls' })).toEqual([])
    expect(fileEditsFromTool('Read', { file_path: 'a.ts' })).toEqual([])
  })

  it('codex file_change with explicit counts', () => {
    const r = fileEditsFromTool('file_change', { changes: { 'a.ts': { added: 5, removed: 2 } } })
    expect(r[0]).toMatchObject({ path: 'a.ts', added: 5, removed: 2 })
  })

  it('codex file_change unknown shape → path-only fallback', () => {
    const r = fileEditsFromTool('file_change', { changes: { 'a.ts': { weird: true } } })
    expect(r[0]).toMatchObject({ path: 'a.ts', op: 'edit', added: 0, removed: 0, hunks: [] })
  })

  it('codex file_change with unified diff string', () => {
    const diff = '@@\n ctx\n-old\n+new1\n+new2'
    const r = fileEditsFromTool('file_change', { changes: { 'a.ts': { diff } } })
    expect(r[0]).toMatchObject({ path: 'a.ts', added: 2, removed: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fileEdits`
Expected: FAIL — `fileEditsFromTool is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/lib/fileEdits.ts`:

```ts
/**
 * Normalize one tool_call into per-file edits. Reads CLI-specific `input` shapes — consistent with
 * how summarizeInput already inspects input on the frontend. Returns [] for non-editing tools.
 *   claude: Edit / MultiEdit / Write / NotebookEdit
 *   codex:  file_change ({ changes }) — best-effort; unknown shapes degrade to path-only.
 */
export function fileEditsFromTool(name: string, input: unknown): FileEdit[] {
  if (!input || typeof input !== 'object') return []
  const o = input as Record<string, any>
  switch (name) {
    case 'Edit': {
      if (typeof o.file_path !== 'string') return []
      const d = lineDiff(str(o.old_string), str(o.new_string))
      return [{ path: o.file_path, op: 'edit', ...d }]
    }
    case 'MultiEdit': {
      if (typeof o.file_path !== 'string' || !Array.isArray(o.edits)) return []
      let added = 0
      let removed = 0
      let truncated = false
      const hunks: DiffLine[] = []
      for (const e of o.edits) {
        const d = lineDiff(str(e?.old_string), str(e?.new_string))
        added += d.added
        removed += d.removed
        truncated = truncated || d.truncated
        hunks.push(...d.hunks)
      }
      const capped = capHunks(added, removed, hunks)
      return [{ path: o.file_path, op: 'edit', ...capped, truncated: truncated || capped.truncated }]
    }
    case 'Write': {
      if (typeof o.file_path !== 'string') return []
      return [{ path: o.file_path, op: 'add', ...lineDiff('', str(o.content)) }]
    }
    case 'NotebookEdit': {
      const path = typeof o.notebook_path === 'string' ? o.notebook_path : typeof o.file_path === 'string' ? o.file_path : null
      if (!path) return []
      return [{ path, op: 'edit', ...lineDiff('', str(o.new_source)) }]
    }
    case 'file_change':
      return codexFileEdits(o)
    default:
      return []
  }
}

function codexFileEdits(o: Record<string, any>): FileEdit[] {
  const changes = o.changes
  if (!changes || typeof changes !== 'object') return []
  return Object.entries(changes as Record<string, any>).map(([path, raw]) => oneCodexEdit(path, raw))
}

function oneCodexEdit(path: string, raw: any): FileEdit {
  const diffText =
    typeof raw === 'string' ? raw
    : typeof raw?.diff === 'string' ? raw.diff
    : typeof raw?.unified_diff === 'string' ? raw.unified_diff
    : null
  if (diffText) return { path, op: 'edit', ...parseUnifiedDiff(diffText) }
  if (raw && (typeof raw.old === 'string' || typeof raw.new === 'string')) {
    return { path, op: raw.old ? 'edit' : 'add', ...lineDiff(str(raw.old), str(raw.new)) }
  }
  if (raw && (typeof raw.added === 'number' || typeof raw.removed === 'number')) {
    return { path, op: 'edit', added: raw.added ?? 0, removed: raw.removed ?? 0, hunks: [], truncated: false }
  }
  return { path, op: 'edit', added: 0, removed: 0, hunks: [], truncated: false }
}

function parseUnifiedDiff(text: string): { added: number; removed: number; hunks: DiffLine[]; truncated: boolean } {
  const hunks: DiffLine[] = []
  let added = 0
  let removed = 0
  for (const ln of text.split('\n')) {
    if (ln.startsWith('+++') || ln.startsWith('---') || ln.startsWith('@@') || ln.startsWith('diff ') || ln.startsWith('index ')) continue
    if (ln.startsWith('+')) { hunks.push({ op: '+', text: ln.slice(1) }); added++ }
    else if (ln.startsWith('-')) { hunks.push({ op: '-', text: ln.slice(1) }); removed++ }
    else hunks.push({ op: ' ', text: ln.startsWith(' ') ? ln.slice(1) : ln })
  }
  return capHunks(added, removed, hunks)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fileEdits`
Expected: PASS (Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/fileEdits.ts web/src/lib/fileEdits.test.ts
git commit -m "feat(web): per-tool file-edit normalization (claude + codex)"
```

---

## Task 3: `fileEditsFromTurn` — aggregate + dedup by path

**Files:**
- Modify: `web/src/lib/fileEdits.ts`
- Test: `web/src/lib/fileEdits.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/fileEdits.test.ts`:

```ts
import { fileEditsFromTurn } from './fileEdits'
import type { ChatTurn } from './chat'

function turnWith(blocks: ChatTurn['blocks']): ChatTurn {
  return { id: 't1', role: 'assistant', ts: 0, blocks }
}

describe('fileEditsFromTurn', () => {
  it('aggregates and dedups by path across tool_calls', () => {
    const turn = turnWith([
      { kind: 'tool_call', id: '1', name: 'Edit', status: 'done', input: { file_path: 'a.ts', old_string: 'x', new_string: 'X' } },
      { kind: 'tool_call', id: '2', name: 'Edit', status: 'done', input: { file_path: 'a.ts', old_string: 'y', new_string: 'Y' } },
      { kind: 'tool_call', id: '3', name: 'Write', status: 'done', input: { file_path: 'b.ts', content: 'one\ntwo' } },
      { kind: 'tool_call', id: '4', name: 'Bash', status: 'done', input: { command: 'ls' } },
    ])
    const edits = fileEditsFromTurn(turn)
    expect(edits).toHaveLength(2)
    const a = edits.find((e) => e.path === 'a.ts')!
    expect(a).toMatchObject({ added: 2, removed: 2 })
    expect(a.hunks.length).toBe(4) // two edits' hunks concatenated
    expect(edits.find((e) => e.path === 'b.ts')).toMatchObject({ op: 'add', added: 2 })
  })

  it('returns [] when no editing tools', () => {
    expect(fileEditsFromTurn(turnWith([{ kind: 'text', text: 'hi' }]))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fileEdits`
Expected: FAIL — `fileEditsFromTurn is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/lib/fileEdits.ts`:

```ts
/** Aggregate every file-editing tool_call in a turn into one FileEdit per path (counts summed, hunks concatenated). */
export function fileEditsFromTurn(turn: ChatTurn): FileEdit[] {
  const byPath = new Map<string, FileEdit>()
  for (const b of turn.blocks) {
    if (b.kind !== 'tool_call') continue
    for (const fe of fileEditsFromTool(b.name, b.input)) {
      const prev = byPath.get(fe.path)
      if (!prev) { byPath.set(fe.path, { ...fe, hunks: fe.hunks.slice() }); continue }
      prev.added += fe.added
      prev.removed += fe.removed
      prev.truncated = prev.truncated || fe.truncated
      prev.hunks.push(...fe.hunks)
      if (prev.op === 'add' && fe.op === 'edit') prev.op = 'edit'
    }
  }
  return [...byPath.values()]
}
```

The unused `Block` import from Task 1 is now legitimately used only via `ChatTurn['blocks']`; if `npm run typecheck` flags `Block` as unused, change the Task 1 import line to `import type { ChatTurn } from './chat'` (drop `Block`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fileEdits` then `npm run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/fileEdits.ts web/src/lib/fileEdits.test.ts
git commit -m "feat(web): aggregate file edits per turn"
```

---

## Task 4: `WorkFold` — collapse agent work in `AssistantTurn`

**Files:**
- Modify: `web/src/components/ChatTranscript.tsx` (imports; `AssistantTurn` lines 48-60; add `splitBlocks` + `WorkFold`)

No unit test (repo has no React Testing Library; component behavior is verified by typecheck + build + manual). Logic-only helper `splitBlocks` is exercised manually.

- [ ] **Step 1: Update imports**

At the top of `web/src/components/ChatTranscript.tsx`, replace:

```ts
import { useEffect, useRef } from 'react'
import type { Block, ChatTurn } from '@/lib/chat'
import { Markdown } from './Markdown'
```

with:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Block, ChatTurn } from '@/lib/chat'
import { fileEditsFromTurn, type FileEdit } from '@/lib/fileEdits'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'
```

- [ ] **Step 2: Rewrite `AssistantTurn` and add `splitBlocks` + `WorkFold`**

Replace the current `AssistantTurn` (lines 48-60) with:

```tsx
function AssistantTurn({ turn }: { turn: ChatTurn }) {
  const { work, answer } = splitBlocks(turn.blocks)
  const edits = useMemo(() => fileEditsFromTurn(turn), [turn])
  const hasFold = work.length > 0
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="w-full max-w-[88%] space-y-2">
        {hasFold && <WorkFold turn={turn} work={work} />}
        {answer.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        {edits.length > 0 && <EditedFilesCard edits={edits} />}
        {turn.streaming && <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" />}
      </div>
      {!hasFold && turn.result && <TurnFooter turn={turn} />}
    </div>
  )
}

/** Split a turn into work (everything up to the trailing text run) and answer (the trailing text run). */
function splitBlocks(blocks: Block[]): { work: Block[]; answer: Block[] } {
  let i = blocks.length
  while (i > 0 && blocks[i - 1].kind === 'text') i--
  return { work: blocks.slice(0, i), answer: blocks.slice(i) }
}

function WorkFold({ turn, work }: { turn: ChatTurn; work: Block[] }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? !!turn.streaming
  const steps = work.filter((b) => b.kind === 'tool_call').length
  const r = turn.result
  const secs = r?.durationMs ? (r.durationMs / 1000).toFixed(r.durationMs < 10000 ? 1 : 0) : null
  let label: string
  if (r?.isError) label = `已中断${r.errorSubtype ? ` (${r.errorSubtype})` : ''}`
  else if (turn.streaming) label = `工作中… · ${steps} 步`
  else label = `${secs ? `Worked for ${secs}s` : '已完成'} · ${steps} 步`
  return (
    <div className="rounded-md border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground"
      >
        <ChevronRight size={14} className={cn('flex-none transition-transform', open && 'rotate-90')} />
        <span className={r?.isError ? 'text-destructive' : undefined}>{label}</span>
        {r?.usage?.output != null && <span className="opacity-70">· {r.usage.output} tok</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2 pl-4">
          {work.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  )
}
```

(`EditedFilesCard` is referenced here but added in Task 5. After this step the file will not typecheck until Task 5 — that is expected; do not run the build between Task 4 and Task 5.)

- [ ] **Step 3: Verify the non-card parts compile in isolation (optional sanity)**

Skip running typecheck now (it will report `EditedFilesCard` missing). Proceed directly to Task 5, then verify together. Do **not** commit a non-compiling tree.

---

## Task 5: `EditedFilesCard` + `EditedFileRow`, then verify & commit

**Files:**
- Modify: `web/src/components/ChatTranscript.tsx` (add `EditedFilesCard` + `EditedFileRow`)

- [ ] **Step 1: Add the card components**

Add to `web/src/components/ChatTranscript.tsx` (e.g. just after `WorkFold`):

```tsx
function EditedFilesCard({ edits }: { edits: FileEdit[] }) {
  const totalAdded = edits.reduce((s, e) => s + e.added, 0)
  const totalRemoved = edits.reduce((s, e) => s + e.removed, 0)
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/60 text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium text-foreground">Edited {edits.length} file{edits.length > 1 ? 's' : ''}</span>
        <span className="tabular-nums">
          <span className="text-success">+{totalAdded}</span> <span className="text-destructive">-{totalRemoved}</span>
        </span>
      </div>
      <ul>
        {edits.map((e) => (
          <EditedFileRow key={e.path} edit={e} />
        ))}
      </ul>
    </div>
  )
}

function EditedFileRow({ edit }: { edit: FileEdit }) {
  const [open, setOpen] = useState(false)
  const expandable = edit.hunks.length > 0
  const slash = edit.path.lastIndexOf('/')
  const dir = slash >= 0 ? edit.path.slice(0, slash + 1) : ''
  const base = slash >= 0 ? edit.path.slice(slash + 1) : edit.path
  return (
    <li className="border-t border-border/40 first:border-t-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default"
      >
        {expandable ? (
          <ChevronRight size={12} className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-3 flex-none" />
        )}
        <span className="truncate">
          <span className="opacity-60">{dir}</span>
          <span className="text-foreground">{base}</span>
        </span>
        <span className="ml-auto flex-none tabular-nums">
          <span className="text-success">+{edit.added}</span> <span className="text-destructive">-{edit.removed}</span>
        </span>
      </button>
      {open && expandable && (
        <div className="border-t border-border/40">
          <pre className="max-h-72 overflow-auto text-[11px] leading-relaxed">
            {edit.hunks.map((h, i) => (
              <div
                key={i}
                className={cn(
                  'px-3',
                  h.op === '+' && 'bg-success/10 text-success',
                  h.op === '-' && 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="select-none opacity-60">{h.op}</span> {h.text}
              </div>
            ))}
          </pre>
          {edit.truncated && <div className="px-3 py-1 text-[11px] text-muted-foreground">diff 已截断</div>}
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 2: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: clean (no errors). If `cn` import path differs, confirm `web/src/lib/utils.ts` exports `cn` and adjust.

- [ ] **Step 3: Run unit tests + build**

Run (from `web/`): `npm test` then `npm run build`
Expected: all tests PASS (including existing `ChatTranscript.test.ts` `prettyToolName`, which must still be exported); build succeeds.

- [ ] **Step 4: Root gates**

Run (from repo root): `npx tsc --noEmit` and `npm test`
Expected: both clean/green (frontend-only change must not affect backend, but confirm).

- [ ] **Step 5: Manual verification**

Run `npm start` (repo root), open the React app, open a session with a finished agent turn that ran tools and edited files. Confirm:
- Folded turn shows `Worked for Ns · N 步`; clicking the chevron expands the steps; while streaming it is expanded and auto-collapses on completion; after a manual toggle the user's choice sticks.
- A pure-text reply shows no fold (just the bubble + `Worked for Ns` footer).
- The `Edited N files +A -R` card appears under the final answer; rows show per-file `+a -r`; clicking a file with a diff expands a red/green view; a codex file with no diff is not expandable.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ChatTranscript.tsx
git commit -m "feat(web): fold agent work + Edited-files card in chat"
```

---

## Self-review notes

- **Spec coverage:** fold split rule → Task 4 `splitBlocks`/`WorkFold`; streaming-default + auto-collapse + user override → `WorkFold` `open` logic; header labels (done/streaming/interrupted + tok) → `WorkFold`; pure-text no-fold → `AssistantTurn` `!hasFold`. Card → Task 5; backend-free normalization (lineDiff/adapters/aggregate) → Tasks 1-3; claude Edit/MultiEdit/Write/NotebookEdit + codex fallback → Task 2; per-path dedup → Task 3; expandable diff + truncation note → `EditedFileRow`. Tests per spec → Tasks 1-3.
- **Naming consistency:** `lineDiff`, `fileEditsFromTool`, `fileEditsFromTurn`, `FileEdit`, `DiffLine`, `splitBlocks`, `WorkFold`, `EditedFilesCard`, `EditedFileRow` used identically across tasks.
- **Known approximation:** `Write` counts whole `content` as added (no prior contents available) — documented in spec. codex counts depend on its `changes` shape; unknown shapes degrade to path-only (Task 2 test covers it).
- **Cross-task gotcha called out:** Task 4 leaves the tree non-compiling until Task 5 (shared `AssistantTurn` edit); do not build or commit between them.
```
