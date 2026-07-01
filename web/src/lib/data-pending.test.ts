import { describe, expect, it } from 'vitest'
import { needsTitleBackfill, type PendingLaunch } from './data'
import type { ApiSession } from './api'

const pending = (over: Partial<PendingLaunch> = {}): PendingLaunch => ({
  tempId: 'tok-1', cli: 'claude', cwd: '/repo', cwdLabel: '/repo', projectId: null,
  todoKey: null, sessionId: 'S1', knownIds: [], createdAt: 0, ...over,
})
const surfaced = (over: Partial<ApiSession> = {}): ApiSession =>
  ({ sessionId: 'S1', cli: 'claude', cwd: '/repo', title: 'a real title', ...over }) as ApiSession

describe('needsTitleBackfill — keep the surfacing poll alive until a REAL row replaces the launching one', () => {
  it('claude that surfaced via the synthetic launching arm (launching=true, no title) keeps polling', () => {
    // The reported bug: resolving pending here freezes the card at "启动中…" (and unrenamable) until an
    // unrelated refresh swaps in the disk row. Must keep polling so refreshSessions() supersedes it.
    expect(needsTitleBackfill(pending({ cli: 'claude' }), surfaced({ launching: true, title: null }))).toBe(true)
  })

  it('claude resolved as a real disk row (has title, not launching) stops polling', () => {
    expect(needsTitleBackfill(pending({ cli: 'claude' }), surfaced({ launching: false, title: 'Pass scene param' }))).toBe(false)
  })

  it('codex/coco without a title still backfills (unchanged)', () => {
    expect(needsTitleBackfill(pending({ cli: 'codex' }), surfaced({ cli: 'codex', title: null }))).toBe(true)
    expect(needsTitleBackfill(pending({ cli: 'coco' }), surfaced({ cli: 'coco', title: '' }))).toBe(true)
  })

  it('any cli still on the launching arm keeps polling, even with a stale title', () => {
    expect(needsTitleBackfill(pending({ cli: 'codex' }), surfaced({ cli: 'codex', launching: true, title: 'x' }))).toBe(true)
  })
})
