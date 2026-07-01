import { describe, it, expect } from 'vitest'
import { selectCurrentSession, runSessionCli, formatSessionLine, type SessionLite } from '../src/cli-data'

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

describe('runSessionCli arg validation (no I/O)', () => {
  it('bind with no task ref throws usage before any request', async () => {
    await expect(runSessionCli(['bind'])).rejects.toThrow(/用法|usage/i)
  })
  it('unknown subcommand throws', async () => {
    await expect(runSessionCli(['wat'])).rejects.toThrow(/未知子命令|session/i)
  })
})

describe('formatSessionLine', () => {
  it('renders cli, activity, bound task title, cwd and short id', () => {
    const line = formatSessionLine(
      { sessionId: 'abcdef12-9999', cli: 'codex', cwd: '/repo', updatedAt: 1, activity: 'running', todoKey: 'task-1' },
      new Map([['task-1', '修复登录']]),
    )
    expect(line).toContain('codex')
    expect(line).toContain('running')
    expect(line).toContain('修复登录')
    expect(line).toContain('/repo')
    expect(line).toContain('[abcdef12]')
  })
  it('shows a dash for an unbound session', () => {
    const line = formatSessionLine({ sessionId: 'x', cli: 'claude', cwd: null, updatedAt: 1, todoKey: null, activity: null }, new Map())
    expect(line).toContain('-')
  })
})
