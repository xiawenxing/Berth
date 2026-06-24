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
