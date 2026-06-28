import { describe, it, expect } from 'vitest'
import { parseLaunchCallback } from '../src/server/launch-callback'
import { openStore } from '../src/db/store'
import { ingestCallback } from '../src/server/launch-callback-watch'

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
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', session_id: '', cwd: '/y' }))).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'x', cwd: '' }))).toBeNull()
    expect(parseLaunchCallback(JSON.stringify({ hook_event_name: 'SessionStart', session_id: null, cwd: '/y' }))).toBeNull()
  })
})

describe('ingestCallback', () => {
  it('binds the pending codex intent named by the token', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'tok-1', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: null, createdAt: 1000, bound: false })
    const rekeyed: Array<[string, string]> = []
    const ok = ingestCallback(s, 'tok-1', { sessionId: 'real-sid', cwd: '/proj' }, { rekey: (a, b) => rekeyed.push([a, b]), isLive: () => false })
    expect(ok).toBe(true)
    expect(s.todoKeyForSession('real-sid')).toBe('task-A')
    expect(s.pendingIntents()).toEqual([])
    expect(rekeyed).toEqual([['tok-1', 'real-sid']])
  })

  it('no-ops for an unknown token', () => {
    const s = openStore(':memory:')
    expect(ingestCallback(s, 'missing', { sessionId: 'x', cwd: '/p' }, { rekey: () => {}, isLive: () => false })).toBe(false)
  })

  it('no-ops when already bound to the SAME session (idempotent)', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'tok-2', cli: 'codex', cwd: '/proj', projectId: null, todoKey: 'task-A', sessionId: 'sid-1', createdAt: 1000, bound: true })
    s.addEdge('task-A', 'sid-1')
    const rekeyed: Array<[string, string]> = []
    expect(ingestCallback(s, 'tok-2', { sessionId: 'sid-1', cwd: '/proj' }, { rekey: (a, b) => rekeyed.push([a, b]), isLive: () => false })).toBe(false)
    expect(rekeyed).toEqual([])
  })

  it('RE-BINDS (authoritative) when channel B bound the intent to the WRONG session (target key free)', () => {
    const s = openStore(':memory:')
    // B mis-bound tok-3 (task-A) to the wrong session 'sid-wrong'.
    s.addLaunchIntent({ id: 'tok-3', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: 'sid-wrong', createdAt: 1000, bound: true })
    s.addEdge('task-A', 'sid-wrong')
    const rekeyed: Array<[string, string]> = []
    // A's ground truth: tok-3 → sid-right.
    expect(ingestCallback(s, 'tok-3', { sessionId: 'sid-right', cwd: '/proj' }, { rekey: (a, b) => rekeyed.push([a, b]), isLive: () => false })).toBe(true)
    // stale edge dropped, correct edge written
    expect(s.edgesByTodo().get('task-A')).toEqual(['sid-right'])
    expect(s.todoKeyForSession('sid-wrong')).toBeNull()
    // pty re-keyed OFF the wrong session id onto the right one
    expect(rekeyed).toEqual([['sid-wrong', 'sid-right']])
  })

  it('corrects the edges but SKIPS the rekey on a swap collision (never kills a live sibling agent)', () => {
    const s = openStore(':memory:')
    s.addLaunchIntent({ id: 'tok-4', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: 'sid-wrong', createdAt: 1000, bound: true })
    s.addEdge('task-A', 'sid-wrong')
    const rekeyed: Array<[string, string]> = []
    // The true key 'sid-right' is ALREADY occupied by a live (sibling) pty.
    expect(ingestCallback(s, 'tok-4', { sessionId: 'sid-right', cwd: '/proj' }, { rekey: (a, b) => rekeyed.push([a, b]), isLive: (k) => k === 'sid-right' })).toBe(true)
    // edges still corrected
    expect(s.edgesByTodo().get('task-A')).toEqual(['sid-right'])
    expect(s.todoKeyForSession('sid-wrong')).toBeNull()
    // but the rekey is skipped — the live sibling agent is NOT killed
    expect(rekeyed).toEqual([])
  })

  it("clears channel B's CROSS-EDGE so a single A callback can't leave a double-bind", () => {
    const s = openStore(':memory:')
    // B swapped the pair: tok-5 (task-A) mis-bound to sid-wrong, and the sibling's session sid-right
    // was cross-edged onto task-OTHER. Only tok-5's A callback fires.
    s.addLaunchIntent({ id: 'tok-5', cli: 'codex', cwd: '/proj', projectId: 'P', todoKey: 'task-A', sessionId: 'sid-wrong', createdAt: 1000, bound: true })
    s.addEdge('task-A', 'sid-wrong')
    s.addEdge('task-OTHER', 'sid-right')
    expect(ingestCallback(s, 'tok-5', { sessionId: 'sid-right', cwd: '/proj' }, { rekey: () => {}, isLive: () => false })).toBe(true)
    expect(s.edgesByTodo().get('task-A')).toEqual(['sid-right'])
    expect(s.edgesByTodo().get('task-OTHER')).toBeUndefined()   // cross-edge cleared
    expect(s.todoKeyForSession('sid-right')).toBe('task-A')
  })
})
