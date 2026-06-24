import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import type { ProxyOptions } from 'vite'
import { quietProxyLogger } from './src/lib/dev-proxy'

// Backend the dev server proxies to. Defaults to the normal Node server (:7777); point at a clean
// test backend with BERTH_API_PORT (e.g. `BERTH_API_PORT=7788`) so a `BERTH_HOME`-isolated instance
// (npm run dev:clean) is reachable from the browser alongside your normal one. BERTH_WEB_PORT moves
// Vite off :5173.
const apiPort = process.env.BERTH_API_PORT || '7777'
const webPort = Number(process.env.BERTH_WEB_PORT) || 5173

// A /pty or /status WebSocket gets torn down abruptly on every page reload / navigation (and on a
// backend restart). Vite's internal proxy handler logs each torn-down upstream socket as a scary
// `ws proxy socket error:` stack trace (EPIPE while writing, ECONNRESET while reading). That's
// expected churn, not a fault — and the logger is the only place to suppress it, since Vite attaches
// its own per-socket error handler *after* our `configure` runs (so a `proxy.on('error')` handler
// here can't pre-empt it, and only ends up double-logging real errors). `quietProxyLogger` drops the
// benign EPIPE/ECONNRESET lines; a real failure to reach the backend (ECONNREFUSED) still logs.
// See src/lib/dev-proxy.ts.
const wsProxy = (): ProxyOptions => ({
  target: `ws://127.0.0.1:${apiPort}`,
  ws: true,
})

// Dev: Vite serves the SPA on :5173 and proxies /api + /pty + /status to the Node
// server (:7777) so the real backend (sessions, the persistent-PTY /pty bridge, live
// /status) is reachable without touching the server. Prod: `vite build` -> web/dist,
// which the Node server will serve once the SPA reaches parity.
export default defineConfig({
  // Served by the Node server under /app (and Vite dev at /app/). Assets get the
  // /app/ prefix so they resolve under the mount.
  base: '/app/',
  // Filter Vite's benign `ws proxy socket error:` churn out of the dev log (see wsProxy above).
  customLogger: quietProxyLogger(createLogger()),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: webPort,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/pty': wsProxy(),
      '/status': wsProxy(),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          // xterm is heavy and only needed when a terminal opens — split it out.
          xterm: ['@xterm/xterm', '@xterm/addon-fit'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
