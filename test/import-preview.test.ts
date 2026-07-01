import { describe, it, expect } from 'vitest'
import { previewByCli, previewByIds } from '../src/server/import-preview'
import type { LogicalSession } from '../src/types'

// Minimal LogicalSession factory — only the fields the preview projection reads.
function s(over: Partial<LogicalSession>): LogicalSession {
  return {
    sessionId: 'id', cli: 'claude', cwd: '/a', title: 't', updatedAt: 0,
    ...over,
  } as LogicalSession
}

const SESSIONS: LogicalSession[] = [
  s({ sessionId: 'c1', cli: 'claude', cwd: '/proj/a', title: 'A1', updatedAt: 30 }),
  s({ sessionId: 'c2', cli: 'claude', cwd: '/proj/a', title: 'A2', updatedAt: 10 }),
  s({ sessionId: 'x1', cli: 'codex',  cwd: '/proj/b', title: 'B1', updatedAt: 20 }),
  s({ sessionId: 'k1', cli: 'coco',   cwd: null,      title: null, updatedAt: 5 }),
]

describe('previewByCli', () => {
  it('returns only the given CLI, recent-first, projected to PreviewSession', () => {
    const out = previewByCli(SESSIONS, 'claude')
    expect(out.map(p => p.sessionId)).toEqual(['c1', 'c2'])   // updatedAt desc, claude only
    expect(out[0]).toEqual({ sessionId: 'c1', cli: 'claude', title: 'A1', cwd: '/proj/a', updatedAt: 30 })
  })

  it('carries cwd (incl. null) and null title through unchanged', () => {
    const out = previewByCli(SESSIONS, 'coco')
    expect(out).toEqual([{ sessionId: 'k1', cli: 'coco', title: null, cwd: null, updatedAt: 5 }])
  })

  it('returns [] for a CLI with no sessions', () => {
    expect(previewByCli(SESSIONS.filter(x => x.cli !== 'codex'), 'codex')).toEqual([])
  })

  it('applies the Berth rename override over the session title (berth名 > 原生/推断)', () => {
    const overrides = new Map([['c1', 'My renamed session']])
    const out = previewByCli(SESSIONS, 'claude', overrides)
    expect(out.find(p => p.sessionId === 'c1')!.title).toBe('My renamed session')
    expect(out.find(p => p.sessionId === 'c2')!.title).toBe('A2')   // no override → unchanged
  })
})

describe('previewByIds', () => {
  it('splits found vs notFound, preserving request order for found', () => {
    const { found, notFound } = previewByIds(SESSIONS, ['x1', 'nope', 'c2'])
    expect(found.map(p => p.sessionId)).toEqual(['x1', 'c2'])
    expect(found[0]).toEqual({ sessionId: 'x1', cli: 'codex', title: 'B1', cwd: '/proj/b', updatedAt: 20 })
    expect(notFound).toEqual(['nope'])
  })

  it('all not found → empty found, all ids in notFound', () => {
    expect(previewByIds(SESSIONS, ['z9', 'z8'])).toEqual({ found: [], notFound: ['z9', 'z8'] })
  })

  it('dedupes repeated ids in the request', () => {
    const { found, notFound } = previewByIds(SESSIONS, ['c1', 'c1'])
    expect(found.map(p => p.sessionId)).toEqual(['c1'])
    expect(notFound).toEqual([])
  })

  it('applies the Berth rename override to found sessions', () => {
    const { found } = previewByIds(SESSIONS, ['x1'], new Map([['x1', '改过的名字']]))
    expect(found[0].title).toBe('改过的名字')
  })
})
