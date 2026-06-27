import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { SessionModule, rowPropsEqual } from './SessionModule'
import { LiveProvider } from '@/lib/live'
import type { SessionRow } from '@/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    cli: 'claude',
    title: '一个会话',
    cwd: '~/proj',
    time: '刚刚',
    status: 'idle',
    pinned: true,
    ...over,
  }
}

describe('SessionModule — 关联任务 search box', () => {
  it('does not open the session when typing Space in the task search box', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let opened = 0

    try {
      await act(async () => {
        root.render(
          <LiveProvider>
            <SessionModule
              pin={[makeRow()]}
              groups={[]}
              onOpen={() => { opened += 1 }}
              tasks={[{ id: 't1', title: '任务一' }]}
              onLinkTask={() => {}}
            />
          </LiveProvider>,
        )
      })

      // Open the task picker popover by clicking the 关联任务 marker.
      const tag = host.querySelector('button[title="关联到任务"]') as HTMLButtonElement | null
      expect(tag).not.toBeNull()
      await act(async () => {
        tag!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      // The popover is portaled to document.body — query the whole document.
      const input = document.querySelector('input[placeholder="搜索任务…"]') as HTMLInputElement | null
      expect(input).not.toBeNull()

      await act(async () => {
        input!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      })

      // Pressing Space inside the search box must NOT open the session.
      expect(opened).toBe(0)
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  })
})

const base: SessionRow = {
  id: 's1', cli: 'codex', title: 'fix the bug', cwd: '~/proj', time: '刚刚',
  updatedAt: 1000, status: 'sail', linkedTask: false, taskId: null, pinned: false,
}
// A single stable tasks ref (ProjectWorkspace memoizes its options array), with distinct handler
// identities as the parent produces fresh closures on every render.
const TASKS = [{ id: 't', title: 'x' }]
const propsWith = (s: SessionRow, showCwd = true, tasks = TASKS) => ({
  s, showCwd, tasks,
  onOpen: () => {}, onPin: () => {},
  onGenerateTitle: () => {}, onLinkTask: () => {}, onDetach: () => {}, onUnimport: () => {},
})

describe('rowPropsEqual — only re-render a row when its OWN display changed', () => {
  // The whole point of the lag fix: one session's /status transition bumps live.rev, which rebuilds
  // EVERY row object. React.memo(Row, rowPropsEqual) must skip rows whose visible data is unchanged
  // even though their handler props are brand-new closures each render.
  it('skips re-render when display fields match but handler identities differ', () => {
    expect(rowPropsEqual(propsWith(base), propsWith({ ...base }))).toBe(true)
  })

  it('re-renders when the ship status changes (sail → dock)', () => {
    expect(rowPropsEqual(propsWith(base), propsWith({ ...base, status: 'dock' }))).toBe(false)
  })

  it('re-renders when the title changes', () => {
    expect(rowPropsEqual(propsWith(base), propsWith({ ...base, title: 'new title' }))).toBe(false)
  })

  it('re-renders when titleGenerating toggles', () => {
    expect(rowPropsEqual(propsWith(base), propsWith({ ...base, titleGenerating: true }))).toBe(false)
  })

  it('re-renders when showCwd changes', () => {
    expect(rowPropsEqual(propsWith(base, true), propsWith(base, false))).toBe(false)
  })

  it('re-renders when pinned toggles', () => {
    expect(rowPropsEqual(propsWith(base), propsWith({ ...base, pinned: true }))).toBe(false)
  })

  it('re-renders when the tasks option list changes (so a renamed/linked task chip refreshes)', () => {
    expect(rowPropsEqual(propsWith(base), propsWith(base, true, [{ id: 't', title: 'renamed' }]))).toBe(false)
  })
})
