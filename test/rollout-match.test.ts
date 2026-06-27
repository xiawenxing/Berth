import { describe, it, expect } from 'vitest'
import { parseSessionMeta, matchRolloutToIntent } from '../src/server/rollout-match'

// Real session_meta first line from codex 0.142.0 (probe result).
const META = JSON.stringify({
  timestamp: '2026-06-27T04:35:33.844Z',
  type: 'session_meta',
  payload: { session_id: '019f075c-aaaa', cwd: '/proj', timestamp: '2026-06-27T04:35:27.374Z' },
})

describe('parseSessionMeta', () => {
  it('extracts sessionId, cwd, and the payload start time in epoch seconds', () => {
    const r = parseSessionMeta(META)
    expect(r?.sessionId).toBe('019f075c-aaaa')
    expect(r?.cwd).toBe('/proj')
    expect(r?.startedAtSec).toBe(Math.floor(Date.parse('2026-06-27T04:35:27.374Z') / 1000))
  })
  it('returns null for non-session_meta or malformed lines', () => {
    expect(parseSessionMeta('nope')).toBeNull()
    expect(parseSessionMeta(JSON.stringify({ type: 'event_msg', payload: {} }))).toBeNull()
  })
})

describe('matchRolloutToIntent (Δ=90s, earliest in window)', () => {
  const intents = [
    { id: 'i-early', cwd: '/proj', createdAt: 1000 },
    { id: 'i-late', cwd: '/proj', createdAt: 1050 },
    { id: 'i-other', cwd: '/elsewhere', createdAt: 1000 },
  ]
  it('matches the earliest same-cwd intent whose window contains the rollout start', () => {
    // rollout starts at 1005 — only i-early[1000,1090] contains it (i-late starts at 1050).
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1005 }, 90)).toBe('i-early')
  })
  it('picks the earliest-createdAt intent when several windows overlap the rollout', () => {
    // rollout at 1060 ∈ i-early[1000,1090] AND i-late[1050,1140] → earliest createdAt wins.
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1060 }, 90)).toBe('i-early')
  })
  it('returns null when cwd differs or the rollout is outside every window', () => {
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 2000 }, 90)).toBeNull()
    expect(matchRolloutToIntent(intents, { cwd: '/nowhere', startedAtSec: 1005 }, 90)).toBeNull()
  })
  it('rejects a rollout that started BEFORE the intent (session starts after launch)', () => {
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 990 }, 90)).toBeNull()
  })
  it('defaults the window to 90s when omitted', () => {
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1089 })).toBe('i-early')
    expect(matchRolloutToIntent(intents, { cwd: '/proj', startedAtSec: 1091 })).toBeNull()
  })
})
