import { describe, it, expect } from 'vitest'
import { parseLaunchCallback } from '../src/server/launch-callback'

// The real envelope captured from codex 0.142.0's SessionStart hook stdin (probe result).
const REAL = JSON.stringify({
  session_id: '019f076d-94d2-7570-b442-82dfc6604c20',
  transcript_path: '/Users/x/.codex/sessions/2026/06/27/rollout-...-019f076d-....jsonl',
  cwd: '/private/tmp/codex-probe/cwd',
  hook_event_name: 'SessionStart',
  permission_mode: 'bypassPermissions',
  source: 'startup',
})

describe('parseLaunchCallback', () => {
  it('extracts sessionId + cwd from a real SessionStart envelope', () => {
    expect(parseLaunchCallback(REAL)).toEqual({
      sessionId: '019f076d-94d2-7570-b442-82dfc6604c20',
      cwd: '/private/tmp/codex-probe/cwd',
    })
  })

  it('returns null for non-JSON, empty, or a wrong event', () => {
    expect(parseLaunchCallback('not json')).toBeNull()
    expect(parseLaunchCallback('')).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', cwd: '/y' }))).toBeNull()
  })

  it('returns null when session_id or cwd is missing', () => {
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', cwd: '/y' }))).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'x' }))).toBeNull()
  })
})
