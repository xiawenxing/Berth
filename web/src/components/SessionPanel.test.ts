import { describe, expect, it } from 'vitest'
import { resolveSessionPanelConnection } from '@/lib/session-panel-connection'
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
