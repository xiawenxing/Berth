import { describe, it, expect } from 'vitest'
import { selectCurrentSession, type SessionLite } from '../src/cli-data'

const S = (over: Partial<SessionLite>): SessionLite =>
  ({ sessionId: 's', cli: 'claude', cwd: '/work', updatedAt: 1, todoKey: null, activity: null, ...over })

// identity canon so the test never touches the filesystem
const id = (p: string) => p

describe('selectCurrentSession', () => {
  const sessions = [
    S({ sessionId: 'a', cwd: '/work', updatedAt: 10 }),
    S({ sessionId: 'b', cwd: '/work', updatedAt: 30 }),
    S({ sessionId: 'c', cwd: '/other', updatedAt: 99 }),
  ]
  it('trusts BERTH_SESSION_ID when present (not inferred)', () => {
    expect(selectCurrentSession(sessions, { berthSessionId: 'zzz', cwd: '/work', canon: id }))
      .toEqual({ sessionId: 'zzz', inferred: false })
  })
  it('falls back to the most-recent session in the same cwd (inferred)', () => {
    expect(selectCurrentSession(sessions, { cwd: '/work', canon: id }))
      .toEqual({ sessionId: 'b', inferred: true })
  })
  it('returns null when no session matches the cwd', () => {
    expect(selectCurrentSession(sessions, { cwd: '/nowhere', canon: id })).toBeNull()
  })
})
