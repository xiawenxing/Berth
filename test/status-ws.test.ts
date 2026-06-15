import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// status-ws reads getCache() to enrich a settled event with the session's fresh transcript time.
const h = vi.hoisted(() => ({ cache: [] as any[] }))
vi.mock('../src/server/store-singleton', () => ({ getCache: () => h.cache }))

import { handleStatusConnection } from '../src/server/status-ws'
import { registerPty, killPty, rekeyPty, IDLE_MS } from '../src/server/pty-registry'

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  return { onData: (cb: any) => { dataCb = cb; return { dispose() {} } }, onExit: () => ({ dispose() {} }),
    write() {}, resize() {}, kill() {}, emit: (d: string) => dataCb(d) } as any
}
function fakeWs() {
  const sent: any[] = []
  let closeCb: () => void = () => {}
  return {
    send: (s: string) => sent.push(JSON.parse(s)),
    on: (ev: string, cb: any) => { if (ev === 'close') closeCb = cb },
    sent, close: () => closeCb(),
  }
}

afterEach(() => { h.cache = [] })

describe('status-ws connection', () => {
  it('sends a snapshot on connect, then streams activity deltas, then stops after close', () => {
    registerPty('st-pre', fakePty(), { running: true })          // a session already live before the client connects
    const ws = fakeWs()
    handleStatusConnection(ws as any)

    expect(ws.sent[0]).toEqual({
      t: 'snap',
      sessions: expect.arrayContaining([{ sessionId: 'st-pre', state: 'running' }]),
    })

    registerPty('st-1', fakePty(), { running: true })             // new live session → delta
    expect(ws.sent).toContainEqual({ t: 'act', sessionId: 'st-1', state: 'running' })

    ws.close()                                 // unsubscribe
    const n = ws.sent.length
    killPty('st-1')                            // would emit exited, but we're unsubscribed
    expect(ws.sent.length).toBe(n)

    killPty('st-pre')
  })

  it('forwards a rekey as a rekey frame', () => {
    registerPty('st-intent', fakePty(), { running: true })
    const ws = fakeWs()
    handleStatusConnection(ws as any)
    rekeyPty('st-intent', 'st-real')
    expect(ws.sent).toContainEqual({ t: 'rekey', from: 'st-intent', to: 'st-real' })
    killPty('st-real')
  })

  it('enriches a settled event with the session\'s fresh last-message time (content, not repaints)', () => {
    vi.useFakeTimers()
    const lastIso = '2026-06-14T01:00:00.000Z'
    const dir = mkdtempSync(join(tmpdir(), 'berth-sw-'))
    const p = join(dir, 't.jsonl')
    writeFileSync(p, JSON.stringify({ type: 'assistant', timestamp: lastIso }) + '\n')
    h.cache = [{ sessionId: 'st-settle', contentSourcePath: p }]

    registerPty('st-settle', fakePty(), { running: true })
    const ws = fakeWs()
    handleStatusConnection(ws as any)
    vi.advanceTimersByTime(IDLE_MS)            // turn settles

    expect(ws.sent).toContainEqual({
      t: 'act', sessionId: 'st-settle', state: 'settled',
      updatedAt: Math.floor(Date.parse(lastIso) / 1000),
    })
    killPty('st-settle')
    vi.useRealTimers()
  })
})
