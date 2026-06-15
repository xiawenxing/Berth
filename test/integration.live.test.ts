import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { collectLogicalSessions } from '../src/sessions'

const live = process.env.BERTH_LIVE === '1' ? describe : describe.skip
live('live store sanity', () => {
  it('lists a sane number of logical sessions; no non-deleted session lacks a content path', () => {
    const all = collectLogicalSessions({
      claudeRoot: homedir() + '/.claude/projects/',
      codexRoot: homedir() + '/.codex/',
      cocoRoot: homedir() + '/Library/Caches/coco/',
    })
    console.log('LIVE logical session count:', all.length,
      '| deleted:', all.filter(s => s.deleted).length,
      '| merged-pairs:', all.filter(s => s.copies.length >= 2).length)
    expect(all.length).toBeGreaterThan(100)
    expect(all.length).toBeLessThan(2000)
    for (const s of all) if (!s.deleted) expect(s.contentSourcePath).toBeTruthy()
  })
})
