import { describe, expect, it } from 'vitest'
import { contentIsUnread, resolveShipStatus } from '../web/src/lib/unread'

describe('unread recovery', () => {
  it('recovers unread sessions from transcript time after the status hub is empty on restart', () => {
    expect(resolveShipStatus({
      activity: undefined,
      updatedAt: 200,
      lastSeen: 100,
      unreadEpoch: 50,
    })).toBe('dock')
  })

  it('does not mark historical never-opened sessions unread before the browser baseline', () => {
    expect(contentIsUnread({
      updatedAt: 100,
      lastSeen: 0,
      unreadEpoch: 150,
    })).toBe(false)
  })

  it('marks never-opened sessions unread once their content is newer than the browser baseline', () => {
    expect(contentIsUnread({
      updatedAt: 200,
      lastSeen: 0,
      unreadEpoch: 150,
    })).toBe(true)
  })

  it('keeps running sessions in the running state even when their content is unread', () => {
    expect(resolveShipStatus({
      activity: 'running',
      updatedAt: 200,
      lastSeen: 100,
      unreadEpoch: 50,
    })).toBe('sail')
  })
})
