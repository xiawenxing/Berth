import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LiveProvider, useLive, type LiveState } from './live'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no WebSocket; LiveProvider opens one on mount. Stub a no-op so the provider mounts.
// Records instances so tests can drive incoming /status frames via `FakeWS.last`.
class FakeWS {
  static last: FakeWS | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeWS.last = this
  }
  close() {}
  /** simulate a server frame */
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

function installMemoryStorage() {
  const storage = createMemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}

beforeEach(() => {
  ;(globalThis as any).WebSocket = FakeWS
  installMemoryStorage()
})
afterEach(() => localStorage.clear())

function mountLive(): { live: () => LiveState; cleanup: () => void } {
  let latest: LiveState | null = null
  function Probe() {
    latest = useLive()
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<LiveProvider><Probe /></LiveProvider>))
  return {
    live: () => latest!,
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

describe('markSeenMany — imported sessions default to read', () => {
  it('flips a session active after the unread-epoch baseline from dock → moored', () => {
    // Baseline far in the past; the session was active after it → would surface as unread (dock).
    localStorage.setItem('berth-unread-epoch', '100')
    const updatedAt = 100000
    const { live, cleanup } = mountLive()
    try {
      expect(live().shipStatus('sess-a', updatedAt)).toBe('dock') // before import: unread
      act(() => live().markSeenMany(['sess-a']))
      expect(live().shipStatus('sess-a', updatedAt)).toBe('moored') // after import: read
    } finally {
      cleanup()
    }
  })

  it('persists the imported ids to the last-seen store (survives reload)', () => {
    localStorage.setItem('berth-unread-epoch', '100')
    const { live, cleanup } = mountLive()
    try {
      act(() => live().markSeenMany(['x', 'y']))
      const seen = JSON.parse(localStorage.getItem('berth-last-seen') || '{}')
      expect(Object.keys(seen).sort()).toEqual(['x', 'y'])
    } finally {
      cleanup()
    }
  })

  it('clears an explicit 标为未读 flag when the session is imported/seen', () => {
    const { live, cleanup } = mountLive()
    try {
      act(() => live().markUnread('z'))
      expect(live().shipStatus('z', 0)).toBe('dock')
      act(() => live().markSeenMany(['z']))
      expect(live().shipStatus('z', 0)).toBe('moored')
    } finally {
      cleanup()
    }
  })
})

describe('setActiveSession — output that lands on the open session stays read', () => {
  it('keeps the active session read when an act frame bumps its updatedAt', () => {
    const { live, cleanup } = mountLive()
    try {
      // Open the session (mark read at open time, as the page does), then declare it active.
      act(() => live().markSeen('open-1'))
      act(() => live().setActiveSession('open-1'))
      // A result lands while the drawer is open: settled with a newer updatedAt.
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'open-1', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('open-1')).toBe('moored') // still read — user is looking at it
    } finally {
      cleanup()
    }
  })

  it('still marks a non-active session unread when its updatedAt bumps', () => {
    localStorage.setItem('berth-unread-epoch', '100') // baseline in the past so new output reads as unread
    const { live, cleanup } = mountLive()
    try {
      act(() => live().markSeen('open-1'))
      act(() => live().setActiveSession('open-1'))
      // Output for a *different* session that isn't open → should become unread.
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'other', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('other')).toBe('dock')
    } finally {
      cleanup()
    }
  })

  it('does not clobber an explicit 标为未读 on the open session', () => {
    const { live, cleanup } = mountLive()
    try {
      act(() => live().setActiveSession('open-1'))
      act(() => live().markUnread('open-1'))
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'open-1', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('open-1')).toBe('dock') // explicit unread sticks
    } finally {
      cleanup()
    }
  })
})
