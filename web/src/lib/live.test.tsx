import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, useLive, useLiveActions, type LiveActions, type LiveState } from './live'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no WebSocket; LiveProvider opens one on mount. Stub a no-op so the provider mounts.
class FakeWS {
  static last: FakeWS | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() { FakeWS.last = this }
  close() {}
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
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

// Server read-state the GET will return; mutate per-test before mounting.
let serverState: { lastSeen: Record<string, number>; unread: Record<string, true>; epoch: number }
let posts: Array<{ url: string; body: any }>

function installFetch() {
  posts = []
  ;(globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/read-state')
      return { ok: true, json: async () => serverState } as any
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    return { ok: true, json: async () => ({}) } as any
  })
}

beforeEach(() => {
  ;(globalThis as any).WebSocket = FakeWS
  installMemoryStorage()
  serverState = { lastSeen: {}, unread: {}, epoch: 100 }
  installFetch()
})
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

// Mount and let the mount-effect's async migrate+GET settle.
async function mountLive(): Promise<{ live: () => LiveState; cleanup: () => void }> {
  let latest: LiveState | null = null
  function Probe() { latest = useLive(); return null }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<LiveProvider><Probe /></LiveProvider>) })
  await act(async () => { await Promise.resolve() })
  return {
    live: () => latest!,
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

async function mountBoth(): Promise<{ live: () => LiveState; actions: () => LiveActions; cleanup: () => void }> {
  let live: LiveState | null = null
  let actions: LiveActions | null = null
  function Probe() {
    live = useLive()
    actions = useLiveActions()
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<LiveProvider><Probe /></LiveProvider>) })
  await act(async () => { await Promise.resolve() })
  return {
    live: () => live!,
    actions: () => actions!,
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

describe('useLiveActions — stable slice (session-list re-render storm fix)', () => {
  // Row consumes ONLY the actions (markSeen/markUnread); it must not re-render on every /status `act`
  // frame. React.memo can't help while a component subscribes to a context whose value changes each
  // bump, so the actions live in their own context with a stable identity across activity bumps.
  it('keeps the same actions object identity after an act frame bumps live state', async () => {
    const { actions, cleanup } = await mountBoth()
    try {
      const before = actions()
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'unrelated', state: 'running' }))
      const after = actions()
      expect(after).toBe(before) // identity unchanged ⇒ memoized rows skip the re-render
    } finally {
      cleanup()
    }
  })

  it('the stable actions still drive unread state', async () => {
    const { live, actions, cleanup } = await mountBoth()
    try {
      act(() => actions().markUnread('z'))
      expect(live().shipStatus('z', 0)).toBe('dock')
      act(() => actions().markSeen('z'))
      expect(live().shipStatus('z', 0)).toBe('moored')
    } finally {
      cleanup()
    }
  })
})

describe('data-changed — {t:data} frame triggers a refetch signal', () => {
  it('dispatches berth:data-changed on a {t:"data"} frame', async () => {
    const { cleanup } = await mountLive()
    let fired = 0
    const handler = () => { fired++ }
    window.addEventListener('berth:data-changed', handler)
    act(() => { FakeWS.last!.emit({ t: 'data' }) })
    window.removeEventListener('berth:data-changed', handler)
    expect(fired).toBe(1)
    cleanup()
  })
})

describe('setActiveSession — output that lands on the open session stays read', () => {
  it('keeps the active session read when an act frame bumps its updatedAt', async () => {
    const { live, cleanup } = await mountLive()
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

  it('still marks a non-active session unread when its updatedAt bumps', async () => {
    localStorage.setItem('berth-unread-epoch', '100') // baseline in the past so new output reads as unread
    const { live, cleanup } = await mountLive()
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

  it('does not clobber an explicit 标为未读 on the open session', async () => {
    const { live, cleanup } = await mountLive()
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

describe('seed from server on mount', () => {
  it('renders unread for a session newer than the server epoch', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('dock')
    } finally { cleanup() }
  })

  it('renders read for a session the server already marked seen', async () => {
    serverState = { lastSeen: { 'sess-a': 100000 }, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('moored')
    } finally { cleanup() }
  })

  it('renders dock for a server explicit-unread session', async () => {
    serverState = { lastSeen: {}, unread: { 'z': true }, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('z', 0)).toBe('dock')
    } finally { cleanup() }
  })
})

describe('GET failure falls back to a moored baseline', () => {
  it('does not flash every session unread when the initial GET fails', async () => {
    ;(globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/read-state') return { ok: false, json: async () => ({}) } as any
      return { ok: true, json: async () => ({}) } as any
    })
    const { live, cleanup } = await mountLive()
    try {
      // No server state applied (GET failed). A session with output must NOT be unread.
      expect(live().shipStatus('sess-a', 100000)).toBe('moored')
    } finally { cleanup() }
  })
})

describe('mutations mirror to the server', () => {
  it('markSeenMany flips to read and POSTs the ids', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      expect(live().shipStatus('sess-a', 100000)).toBe('dock')
      await act(async () => { live().markSeenMany(['sess-a']) })
      expect(live().shipStatus('sess-a', 100000)).toBe('moored')
      const seen = posts.find(p => p.url === '/api/read-state/seen')
      expect(seen?.body.sessionIds).toEqual(['sess-a'])
    } finally { cleanup() }
  })

  it('markUnread flips to dock and POSTs the id', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markUnread('z') })
      expect(live().shipStatus('z', 0)).toBe('dock')
      expect(posts.find(p => p.url === '/api/read-state/unread')?.body.sessionId).toBe('z')
    } finally { cleanup() }
  })

  it('markSeen clears a prior explicit unread', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markUnread('z') })
      expect(live().shipStatus('z', 0)).toBe('dock')
      await act(async () => { live().markSeen('z') })
      expect(live().shipStatus('z', 0)).toBe('moored')
    } finally { cleanup() }
  })
})

describe('mount hydration does not clobber an in-flight mutation', () => {
  it('keeps a session marked read locally even if the GET response predates it', async () => {
    // Defer the GET so we can mutate before it resolves.
    let resolveGet: (v: any) => void = () => {}
    const getPromise = new Promise((r) => { resolveGet = r })
    ;(globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/read-state')
        return { ok: true, json: async () => getPromise } as any
      return { ok: true, json: async () => ({}) } as any
    })
    // Server snapshot says sess-a is NOT seen (would be unread).
    const serverSnapshot = { lastSeen: {}, unread: {}, epoch: 100 }

    let latest: LiveState | null = null
    function Probe() { latest = useLive(); return null }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<LiveProvider><Probe /></LiveProvider>) })

    // Mutate while the GET is still pending, then let it resolve.
    await act(async () => { latest!.markSeen('sess-a') })
    await act(async () => { resolveGet(serverSnapshot); await Promise.resolve() })

    // Local "seen" must survive the hydration merge.
    expect(latest!.shipStatus('sess-a', 100000)).toBe('moored')
    act(() => root.unmount()); host.remove()
  })
})

describe('active session stays read', () => {
  it('keeps the active session read when an act frame bumps its updatedAt', async () => {
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markSeen('open-1') })
      act(() => live().setActiveSession('open-1'))
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'open-1', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('open-1')).toBe('moored')
    } finally { cleanup() }
  })

  it('still marks a non-active session unread when its updatedAt bumps', async () => {
    serverState = { lastSeen: {}, unread: {}, epoch: 100 }
    const { live, cleanup } = await mountLive()
    try {
      await act(async () => { live().markSeen('open-1') })
      act(() => live().setActiveSession('open-1'))
      act(() => FakeWS.last!.emit({ t: 'act', sessionId: 'other', state: 'settled', updatedAt: 999999999 }))
      expect(live().shipStatus('other')).toBe('dock')
    } finally { cleanup() }
  })
})

describe('one-time localStorage migration', () => {
  it('POSTs legacy localStorage read-state to /import once, then sets the guard', async () => {
    localStorage.setItem('berth-last-seen', JSON.stringify({ a: 500 }))
    localStorage.setItem('berth-unread', JSON.stringify({ b: true }))
    localStorage.setItem('berth-unread-epoch', '42')
    const { cleanup } = await mountLive()
    try {
      const imp = posts.find(p => p.url === '/api/read-state/import')
      expect(imp?.body).toEqual({ seen: { a: 500 }, unread: { b: true }, epoch: 42 })
      expect(localStorage.getItem('berth-read-migrated')).toBe('1')
    } finally { cleanup() }
  })

  it('does not migrate when there is no legacy localStorage', async () => {
    const { cleanup } = await mountLive()
    try {
      expect(posts.find(p => p.url === '/api/read-state/import')).toBeUndefined()
    } finally { cleanup() }
  })
})
