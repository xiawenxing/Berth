import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { SessionModule } from './SessionModule'
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
