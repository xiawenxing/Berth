import { describe, expect, it } from 'vitest'
import { resolveSessionPanelConnection, resolveSessionPanelRenderer } from '@/lib/session-panel-connection'
import type { LaunchSpec } from '@/lib/ui-store'

describe('resolveSessionPanelConnection', () => {
  it('uses resume mode for an existing session', () => {
    expect(resolveSessionPanelConnection('sess-1')).toEqual({ sessionId: 'sess-1' })
  })

  it('keeps launch mode mounted once the real session id is known', () => {
    const launch: LaunchSpec = {
      cli: 'codex',
      cwd: '/repo',
      launchToken: 'launch-1',
      prompt: 'hello',
    }

    expect(resolveSessionPanelConnection('sess-1', launch)).toEqual({ launch })
  })
})

describe('resolveSessionPanelRenderer', () => {
  it('forces existing coco sessions through the chat/per-turn renderer', () => {
    expect(resolveSessionPanelRenderer('coco', 'A', { sessionId: 'sess-1' })).toBe('B')
  })

  it('keeps task launches in the selected terminal renderer', () => {
    const launch: LaunchSpec = {
      cli: 'coco',
      cwd: '/repo',
      launchToken: 'launch-1',
      todoKey: 'task-1',
    }
    expect(resolveSessionPanelRenderer('coco', 'A', { launch })).toBe('A')
  })

  it('routes free coco launches through chat to match the prime socket', () => {
    expect(resolveSessionPanelRenderer('coco', 'A', { launch: { cli: 'coco', cwd: '/repo' } })).toBe('B')
  })

  // claude is terminal-only: Model B is still under development and must not surface for it. Launch
  // and resume must agree, or reopening a session makes the server kill + respawn the live agent
  // just to switch renderer.
  it('keeps claude in the terminal renderer everywhere, ignoring the global mode', () => {
    expect(resolveSessionPanelRenderer('claude', 'A', { launch: { cli: 'claude', cwd: '/repo' } })).toBe('A')
    expect(resolveSessionPanelRenderer('claude', 'B', { launch: { cli: 'claude', cwd: '/repo' } })).toBe('A')
    expect(resolveSessionPanelRenderer('claude', 'A', { sessionId: 'sess-1' })).toBe('A')
    expect(resolveSessionPanelRenderer('claude', 'B', { sessionId: 'sess-1' })).toBe('A')
  })

  it('respects the global chat renderer for codex sessions', () => {
    expect(resolveSessionPanelRenderer('codex', 'B', { sessionId: 'sess-1' })).toBe('B')
    expect(resolveSessionPanelRenderer('codex', 'A', { sessionId: 'sess-1' })).toBe('A')
  })
})
