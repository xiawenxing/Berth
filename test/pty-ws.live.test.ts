import { describe, it, expect, afterAll } from 'vitest'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { createApp, attachWebSockets } from '../src/server/index'
import { refresh, getCache } from '../src/server/store-singleton'

const live = process.env.BERTH_LIVE === '1' ? describe : describe.skip
let server: ReturnType<typeof createServer>
afterAll(() => server?.close())

live('pty-ws bridge', () => {
  it('resumes the most-recent non-deleted session over a WebSocket and streams output', async () => {
    refresh()
    const target = getCache().filter(s => !s.deleted && s.resume).sort((a,b)=>b.updatedAt-a.updatedAt)[0]
    server = createServer(createApp()); attachWebSockets(server)
    const port: number = await new Promise(r => server.listen(0, () => r((server.address() as any).port)))
    console.log('WS resuming:', target.resume!.cli, target.sessionId)
    const ws = new WebSocket(`ws://localhost:${port}/pty?sessionId=${target.sessionId}&cols=120&rows=30`)
    const got = await new Promise<boolean>((resolve) => {
      let buf = ''
      const t = setTimeout(() => resolve(buf.length > 0), 9000)
      ws.on('message', (d) => { buf += d.toString(); if (buf.length > 50) { clearTimeout(t); resolve(true) } })
      ws.on('error', () => { clearTimeout(t); resolve(false) })
    })
    ws.close()
    expect(got).toBe(true)
  }, 15000)
})
