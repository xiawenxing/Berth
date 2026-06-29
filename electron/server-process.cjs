// Berth server bootstrap for Electron's utilityProcess. This runs in a SEPARATE OS process (its own
// Node event loop), NOT on the Electron main/UI thread — so a busy server (session scans, PTY I/O)
// can never freeze the window. It boots the same compiled server the CLI uses and reports the bound
// port back to the main process via process.parentPort.
//
// CommonJS (.cjs) so Electron's utilityProcess loads it directly; the server core is ESM, bridged via
// dynamic import(). Native addons (better-sqlite3, node-pty) load here because the utilityProcess runs
// Electron's Node ABI, the same ABI electron-rebuild compiled them for.
const path = require('node:path')

const serverEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js')
const port = Number(process.env.PORT) || 7777
const host = process.env.HOST || '127.0.0.1'

function tell(msg) {
  // parentPort is present under utilityProcess; guard so a stray direct run doesn't crash.
  try { process.parentPort?.postMessage(msg) } catch { /* no parent — ignore */ }
}

import(serverEntry)
  .then(({ start }) => start(port, host))
  .then(({ port: boundPort }) => tell({ type: 'listening', port: boundPort, host }))
  .catch((err) => {
    tell({ type: 'error', message: String((err && err.stack) || err) })
    process.exit(1)
  })
