import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, useLive, type LiveState } from './live'

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
