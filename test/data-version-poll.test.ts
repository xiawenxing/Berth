import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/server/pty-registry', () => ({ snapshotActivity: () => [], subscribeActivity: () => {} }))
let version = 1
vi.mock('../src/server/store-singleton', () => ({ getCache: () => [], getStore: () => ({ dataVersion: () => version }) }))
import { handleStatusConnection, startDataVersionPoll } from '../src/server/status-ws'

describe('startDataVersionPoll', () => {
  it('broadcasts {t:data} when data_version changes', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    handleStatusConnection({ send: (s: string) => sent.push(s), on: () => {} } as any)
    sent.length = 0
    const stop = startDataVersionPoll(50)
    version = 2
    vi.advanceTimersByTime(60)          // poll ticks, sees change, schedules debounced broadcast
    vi.advanceTimersByTime(200)         // debounce (B1) fires
    expect(sent.some(s => JSON.parse(s).t === 'data')).toBe(true)
    stop(); vi.useRealTimers()
  })
  it('does not broadcast when data_version is unchanged', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    handleStatusConnection({ send: (s: string) => sent.push(s), on: () => {} } as any)
    sent.length = 0
    const stop = startDataVersionPoll(50)
    vi.advanceTimersByTime(300)         // no version change
    expect(sent.some(s => JSON.parse(s).t === 'data')).toBe(false)
    stop(); vi.useRealTimers()
  })
})
