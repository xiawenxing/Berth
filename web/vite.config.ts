import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Dev: Vite serves the SPA on :5173 and proxies /api + /pty + /status to the Node
// server (:7777) so the real backend (sessions, the persistent-PTY /pty bridge, live
// /status) is reachable without touching the server. Prod: `vite build` -> web/dist,
// which the Node server will serve once the SPA reaches parity.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7777',
      '/pty': { target: 'ws://127.0.0.1:7777', ws: true },
      '/status': { target: 'ws://127.0.0.1:7777', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
