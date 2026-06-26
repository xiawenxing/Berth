import { describe, it, expect } from 'vitest'
import { lineDiff } from './fileEdits'
import { fileEditsFromTool } from './fileEdits'

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
