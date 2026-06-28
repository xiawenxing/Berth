import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/server/pty-registry', () => ({ snapshotActivity: () => [], subscribeActivity: () => {} }))
vi.mock('../src/server/store-singleton', () => ({ getCache: () => [] }))
import { handleStatusConnection, broadcastDataChanged } from '../src/server/status-ws'

describe('broadcastDataChanged', () => {
  it('sends a single {t:"data"} frame to connected clients after debounce', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    handleStatusConnection({ send: (s: string) => sent.push(s), on: () => {} } as any)
    sent.length = 0                          // drop the initial snapshot frame
    broadcastDataChanged(); broadcastDataChanged()   // coalesced
    vi.advanceTimersByTime(200)
    expect(sent.filter(s => JSON.parse(s).t === 'data')).toHaveLength(1)
    vi.useRealTimers()
  })
})
