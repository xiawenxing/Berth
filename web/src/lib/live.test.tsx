import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LiveProvider, useLive, type LiveState } from './live'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no WebSocket; LiveProvider opens one on mount. Stub a no-op so the provider mounts.
class FakeWS {
  onmessage: ((e: unknown) => void) | null = null
  onclose: (() => void) | null = null
  close() {}
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
