import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from './Terminal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const termWrites = vi.hoisted(() => [] as string[])

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 120
    rows = 30
    textarea = null
    buffer = { active: { length: 1 } }
    loadAddon() {}
    open() {}
    focus() {}
    write(data: string, done?: () => void) { termWrites.push(data); done?.() }
    onData() { return { dispose() {} } }
    onScroll() { return { dispose() {} } }
    scrollToBottom() {}
    scrollToTop() {}
    scrollLines() {}
    modes = { mouseTrackingMode: 'none' }
    attachCustomWheelEventHandler() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {}; dispose() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  binaryType = ''
  onmessage: ((event: { data: string }) => void) | null = null
  private listeners = new Map<string, Array<() => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  sent: string[] = []
  send(data: string) { this.sent.push(data) }
  close() {}
  emit(data: string) { this.onmessage?.({ data }) }
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.useFakeTimers()
  termWrites.length = 0
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Terminal cold resume status', () => {
  it('shows restoring after old replay and keeps it until fresh resume output settles', () => {
    act(() => root.render(<Terminal sessionId="session-1" />))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('sessionId=session-1')

    // Persisted output is replayed first. It is the previously interrupted screen, not readiness.
    act(() => ws.emit('previous interrupted screen'))
    expect(host.querySelector('[role="status"]')).toBeNull()

    act(() => ws.emit(JSON.stringify({ __berth: 'restoring', sessionId: 'session-1', cli: 'codex' })))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在恢复会话，等待输入就绪')

    act(() => ws.emit('fresh codex resume output'))
    act(() => vi.advanceTimersByTime(1_599))
    expect(host.querySelector('[role="status"]')).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
})

describe('Terminal stream-mode pinning', () => {
  // Regression: a session launched into Model B that was never typed into writes no jsonl, so the
  // server cannot respawn it as a TUI and pins it to its stream driver. Before the fix the terminal
  // printed the driver's chat snapshot verbatim: {"type":"snapshot","turns":[]}.
  it('reports the pin and stops rendering the chat frames that follow', () => {
    const onStreamModePinned = vi.fn()
    act(() => root.render(<Terminal sessionId="session-1" onStreamModePinned={onStreamModePinned} />))
    const ws = FakeWebSocket.instances[0]

    act(() => ws.emit(JSON.stringify({ __berth: 'mode', mode: 'stream', sessionId: 'session-1' })))
    expect(onStreamModePinned).toHaveBeenCalledTimes(1)

    act(() => ws.emit('{"type":"snapshot","turns":[]}'))
    expect(termWrites.join('')).not.toContain('snapshot')
  })

  it('still renders terminal bytes when the session is not pinned', () => {
    act(() => root.render(<Terminal sessionId="session-1" />))
    const ws = FakeWebSocket.instances[0]

    act(() => ws.emit('normal tui output'))
    expect(termWrites.join('')).toContain('normal tui output')
  })
})
