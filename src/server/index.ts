import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createServer, type Server } from 'node:http'
import { api } from './api'
import { refresh, getCache, initData } from './store-singleton'
import { createPtyWss } from './pty-ws'
import { createStatusWss } from './status-ws'
import { killAllPtys } from './pty-registry'
import { resolvePublicDir, resolveWebDistDir } from './public-dir'
import { warmAgentBinaryCaches } from '../pty/binaries'
import { warmSessionPool } from './warm-pool'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Resolved by walking up to a public/index.html, so it works both in dev (tsx, src/server) and when
// compiled (dist/server) with public/ shipped at the package root. See public-dir.ts.
const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolvePublicDir(HERE)
const WEB_DIST = resolveWebDistDir(HERE)   // Berth 2.0 React SPA (web/dist), served at /app when built

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

export function createApp(webDist: string | null = WEB_DIST) {
  const app = express()
  app.use(express.json({ limit: '30mb' }))   // pasted images (base64) can be a few MB
  app.use('/api', api)
  // Berth 2.0 React SPA at /app (when built). HashRouter, so static serving + an
  // index.html fallback for the bare /app path is all that's needed.
  if (webDist) {
    // 1.0 entry is deprecated: route the bare root to the 2.0 SPA. The legacy public/ UI stays
    // statically served below (still reachable at /index.html for an old client), but / no longer
    // lands on it. Registered before express.static(PUBLIC) so it wins.
    app.get('/', (_req, res) => res.redirect(302, '/app/'))
    app.use('/app', express.static(webDist))
    app.get('/app', (_req, res) => res.sendFile(join(webDist, 'index.html')))
  }
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
  warmAgentBinaryCaches()
  installShutdownCleanup()
  const server = createServer(createApp())
  attachWebSockets(server)   // /pty terminals + /status live-activity broadcast, one upgrade router
  const hasWeb = !!WEB_DIST   // 2.0 SPA built and served at /app → callers open /app/ directly
  return new Promise<{ port: number; hasWeb: boolean }>((resolve, reject) => {
    const onListenError = (error: Error) => reject(error)
    server.once('error', onListenError)
    server.listen(port, host, () => {
      server.off('error', onListenError)
      const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
      const realPort = (server.address() as any)?.port ?? port
      console.log(`Berth: ${getCache().length} sessions | http://${shown}:${realPort}${hasWeb ? '/app/' : ''}`)
      // Pre-spawn the top-K sessions off the request path so their first open is instant. Detached:
      // warming must never delay the listen, and a warm failure must never crash startup.
      void warmSessionPool().catch(() => {})
      resolve({ port: realPort, hasWeb })
    })
  })
}
