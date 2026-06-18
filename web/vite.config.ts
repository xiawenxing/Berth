import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import type { ProxyOptions } from 'vite'

// A /pty or /status WebSocket gets torn down abruptly on every page reload / navigation (and on a
// backend restart), which surfaces upstream as ECONNRESET. That's expected churn, not a fault — so
// swallow the reset instead of letting http-proxy print a scary `ws proxy socket error` each time.
// Any other proxy error still logs.
const wsProxy = (): ProxyOptions => ({
  target: 'ws://127.0.0.1:7777',
  ws: true,
  configure: (proxy) => {
    proxy.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return
      console.error('[proxy]', err)
    })
  },
})

// Dev: Vite serves the SPA on :5173 and proxies /api + /pty + /status to the Node
// server (:7777) so the real backend (sessions, the persistent-PTY /pty bridge, live
// /status) is reachable without touching the server. Prod: `vite build` -> web/dist,
// which the Node server will serve once the SPA reaches parity.
export default defineConfig({
  // Served by the Node server under /app (and Vite dev at /app/). Assets get the
  // /app/ prefix so they resolve under the mount.
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7777',
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
