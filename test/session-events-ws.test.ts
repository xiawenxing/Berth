import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleSessionEventsConnection } from '../src/server/session-events-ws'

const h = vi.hoisted(() => ({ cache: [] as any[] }))
vi.mock('../src/server/store-singleton', () => ({ getCache: () => h.cache }))

function jl(...objs: any[]): string {
  return objs.map(o => JSON.stringify(o)).join('\n') + '\n'
}

function fakeWs() {
  const sent: any[] = []
  let closeCb: () => void = () => {}
  return {
    send: (s: string) => sent.push(JSON.parse(s)),
    close: () => closeCb(),
    on: (ev: string, cb: any) => { if (ev === 'close') closeCb = cb },
    sent,
  }
}

beforeEach(() => { h.cache = [] })

describe('session-events websocket', () => {
  it('pushes parsed turns when the transcript file changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-session-events-'))
    const p = join(dir, 's.jsonl')
    writeFileSync(p, jl({ type: 'user', message: { role: 'user', content: 'hi' } }))
    h.cache = [{ sessionId: 's1', cli: 'claude', contentSourcePath: p }]

    const ws = fakeWs()
    handleSessionEventsConnection(ws as any, '/session-events?sessionId=s1')

    expect(ws.sent[0]).toMatchObject({ t: 'turns', sessionId: 's1' })
    expect(ws.sent[0].turns.map((t: any) => t.text)).toEqual(['hi'])

    await new Promise(resolve => setTimeout(resolve, 80))
    appendFileSync(p, jl({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }))
    await vi.waitFor(() => {
      expect(ws.sent.at(-1).turns.map((t: any) => t.text)).toEqual(['hi', 'hello'])
    }, { timeout: 1200 })

    ws.close()
  })
})
