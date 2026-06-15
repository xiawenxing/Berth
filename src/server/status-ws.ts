import { WebSocketServer, type WebSocket } from 'ws'
import { snapshotActivity, subscribeActivity } from './pty-registry'
import type { ActivityEvent } from './activity'
import { getCache } from './store-singleton'
import { lastMessageTime } from '../adapters/transcript-time'

/**
 * Broadcast-only `/status` channel: it never reads client messages. Each connected browser gets one
 * snapshot frame on connect, then every per-session activity transition as a JSON delta.
 *
 * Two distinct signals ride this channel:
 *  - the SPINNER (running/settled/exited), straight from the live pty-registry FSM; and
 *  - the UNREAD refresh: a `settled` frame carries the session's fresh `updatedAt` (the last real
 *    MESSAGE time, read from its transcript). The red dot is driven by that content timestamp, NOT by
 *    the settle itself — so a resize/idle repaint that ends in a settle but adds no message pushes an
 *    unchanged time and can never re-light the dot.
 *
 * One subscription to the bus fans out to every connected client, so the transcript is read at most
 * once per settle regardless of how many browsers are watching.
 */

type StatusSocket = Pick<WebSocket, 'send' | 'on'>

const clients = new Set<StatusSocket>()
let busSubscribed = false

function broadcast(json: string): void {
  for (const ws of clients) { try { ws.send(json) } catch {} }
}

/** The fresh last-real-message time for a session, or null if unknown — used to refresh the unread dot. */
function freshUpdatedAt(sessionId: string): number | null {
  const s = getCache().find(x => x.sessionId === sessionId)
  if (!s || !s.contentSourcePath) return null
  return lastMessageTime(s.contentSourcePath)
}

function frameFor(e: ActivityEvent): object {
  if (e.kind === 'rekey') return { t: 'rekey', from: e.from, to: e.to }
  const frame: any = { t: 'act', sessionId: e.sessionId, state: e.state }
  if (e.state === 'settled') {
    const updatedAt = freshUpdatedAt(e.sessionId)
    if (updatedAt != null) frame.updatedAt = updatedAt
  }
  return frame
}

/** Wire one client: send the current snapshot, then stream deltas. Detach the socket on close. */
export function handleStatusConnection(ws: StatusSocket): void {
  try { ws.send(JSON.stringify({ t: 'snap', sessions: snapshotActivity() })) } catch {}
  clients.add(ws)
  if (!busSubscribed) {   // one shared subscription for all clients (read each transcript at most once)
    busSubscribed = true
    subscribeActivity(e => broadcast(JSON.stringify(frameFor(e))))
  }
  ws.on('close', () => { clients.delete(ws) })
}

/** Build the `/status` WebSocketServer (noServer mode; the upgrade router in index.ts dispatches to it). */
export function createStatusWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', ws => handleStatusConnection(ws))
  return wss
}
