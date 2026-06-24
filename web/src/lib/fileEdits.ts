import type { ChatTurn } from './chat'

export interface DiffLine { op: ' ' | '+' | '-'; text: string }

export interface FileEdit {
  path: string
  /** Informational classification; the card renders from added/removed/hunks, not op. 'delete' is
   *  reserved for a future "deleted file" affordance — no adapter emits it yet. */
  op: 'edit' | 'add' | 'delete'
  added: number
  removed: number
  hunks: DiffLine[]
  truncated: boolean
}

const MAX_DIFF_LINES = 400

/** Line-level LCS diff → counts + hunks, capped at MAX_DIFF_LINES.
 *  Note: added/removed are totals for the full diff; hunks may be truncated (see `truncated`). */
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
