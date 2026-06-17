import { existsSync, watch, type FSWatcher } from 'node:fs'
import { dirname, basename } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { getCache } from './store-singleton'
import { parseTranscriptTurns, resolveTranscriptPath } from './transcript-turns'

type SessionEventSocket = Pick<WebSocket, 'send' | 'close' | 'on'>

function sendTurns(ws: SessionEventSocket, sessionId: string): void {
  const s = getCache().find(x => x.sessionId === sessionId)
  if (!s || !s.contentSourcePath) {
    try { ws.send(JSON.stringify({ t: 'error', error: 'no readable transcript' })) } catch {}
    return
  }
  const turns = parseTranscriptTurns(s.cli, s.contentSourcePath)
  try { ws.send(JSON.stringify({ t: 'turns', sessionId, turns })) } catch {}
}

function watchTranscript(sessionId: string, ws: SessionEventSocket): () => void {
  const s = getCache().find(x => x.sessionId === sessionId)
  if (!s || !s.contentSourcePath) return () => {}

  const transcriptPath = resolveTranscriptPath(s.cli, s.contentSourcePath)
  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => sendTurns(ws, sessionId), 80)
  }

  try {
    if (existsSync(transcriptPath)) {
      watcher = watch(transcriptPath, { persistent: false }, trigger)
      trigger()
    } else {
      const file = basename(transcriptPath)
      watcher = watch(dirname(transcriptPath), { persistent: false }, (_event, changed) => {
        if (!changed || changed.toString() === file) trigger()
      })
    }
  } catch {
    return () => {}
  }

  return () => {
    if (timer) clearTimeout(timer)
    try { watcher?.close() } catch {}
  }
}

export function handleSessionEventsConnection(ws: SessionEventSocket, reqUrl: string | undefined): void {
  const url = new URL(reqUrl ?? '', 'http://localhost')
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) {
    try { ws.send(JSON.stringify({ t: 'error', error: 'sessionId required' })) } catch {}
    ws.close()
    return
  }

  sendTurns(ws, sessionId)
  const stop = watchTranscript(sessionId, ws)
  ws.on('close', stop)
}

export function createSessionEventsWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => handleSessionEventsConnection(ws, req.url))
  return wss
}
