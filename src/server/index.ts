import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createServer, type Server } from 'node:http'
import { api } from './api'
import { refresh, getCache, initData } from './store-singleton'
import { createPtyWss } from './pty-ws'
import { createStatusWss } from './status-ws'
import { killAllPtys } from './pty-registry'
import { resolvePublicDir } from './public-dir'

// Resolved by walking up to a public/index.html, so it works both in dev (tsx, src/server) and when
// compiled (dist/server) with public/ shipped at the package root. See public-dir.ts.
const PUBLIC = resolvePublicDir(dirname(fileURLToPath(import.meta.url)))

/**
 * One upgrade listener routes WebSocket upgrades by path to the matching (noServer) WebSocketServer.
 * Two `{ server, path }` servers on one http.Server abort each other's handshakes with 400 — so /pty
 * and /status MUST share a single router.
 */
export function attachWebSockets(server: Server) {
  const routes: Record<string, ReturnType<typeof createPtyWss>> = {
    '/pty': createPtyWss(),
    '/status': createStatusWss(),
  }
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0]
    const wss = routes[pathname]
    if (!wss) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })
}

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '30mb' }))   // pasted images (base64) can be a few MB
  app.use('/api', api)
  app.use(express.static(PUBLIC))
  return app
}

/** Kill all live PTYs on shutdown so child agent processes (and their whole subtree) aren't
 *  orphaned/reparented to launchd. Registered once. SIGHUP matters too: closing the terminal that
 *  ran `npm start` sends SIGHUP, and without a handler Node dies WITHOUT running `exit` listeners —
 *  the prime source of leaked sessions. `exit` is the best-effort sweep for clean/uncaught exits.
 *  (SIGKILL can't be caught — those orphans are unavoidable in-process; see ARCHITECTURE.md.) */
function installShutdownCleanup() {
  let done = false
  const sweep = () => { if (done) return; done = true; killAllPtys() }
  process.on('exit', sweep)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => { sweep(); process.exit(0) })
  }
}

export async function start(
  port = Number(process.env.PORT) || 7777,
  host = process.env.HOST || '127.0.0.1',   // loopback by default: /pty spawns CLIs with bypass-permission
                                            // flags, so binding all interfaces would be LAN RCE. Opt out knowingly.
) {
  await initData()   // one-time recordId→uuid migration before anything reads the data layer
  refresh()
  installShutdownCleanup()
  const server = createServer(createApp())
  attachWebSockets(server)   // /pty terminals + /status live-activity broadcast, one upgrade router
  return new Promise<{ port: number }>((resolve) => {
    server.listen(port, host, () => {
      const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
      console.log(`Berth: ${getCache().length} sessions | http://${shown}:${(server.address() as any)?.port ?? port}`)
      resolve({ port: (server.address() as any)?.port ?? port })
    })
  })
}
