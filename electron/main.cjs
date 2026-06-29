// Electron main process — the desktop "app" form. It is a THIN launcher around the same core the CLI
// uses: it boots the compiled server (dist/server/index.js) on a free loopback port, then points a
// BrowserWindow at it. The persistent-PTY-over-WS model carries over unchanged. CommonJS (.cjs) for
// the widest Electron compatibility; the core is ESM, loaded via dynamic import().
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

let mainWindow = null

// Canonical port: honour $PORT so both the CLI and the app agree on the same default.
const CANON_PORT = Number(process.env.PORT) || 7777
const CANON_HOST = '127.0.0.1'

// Returns true when a Berth server is already listening on `port`.
async function berthHealth(port) {
  try {
    const r = await fetch(`http://${CANON_HOST}:${port}/api/health`)
    return r.ok && (await r.json())?.berth === true
  } catch { return false }
}

// 1) Reuse a Berth server already running on the canonical port (e.g. started by `berth start`).
// 2) Otherwise boot our own server on the canonical port.
// 3) If the canonical port is held by a non-Berth process, fall back to a free port.
//    start() writes ~/.berth/server.json in all cases, so callers can discover the address.
async function resolveServer() {
  if (await berthHealth(CANON_PORT)) return CANON_PORT
  // dist/server/index.js is ESM; dynamic import() bridges from this CJS main.
  const serverEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js')
  const { start } = await import(serverEntry)
  try {
    // Attempt to bind the canonical port (loopback only — single-user, unauthenticated).
    const { port } = await start(CANON_PORT, CANON_HOST)
    return port
  } catch (e) {
    // Canonical port taken by a non-Berth process → let the OS assign a free port.
    const { port } = await start(0, CANON_HOST)
    return port
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Berth',
    backgroundColor: '#0b0b0c',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 1.0 entry is deprecated — load the 2.0 SPA directly. The server also 302s / → /app/, so this is
  // belt-and-suspenders.
  mainWindow.loadURL(`http://127.0.0.1:${port}/app/`)
  // Open external links (e.g. obsidian://, http docs) in the user's real browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  let port
  try {
    port = await resolveServer()
  } catch (e) {
    console.error('Berth: failed to start server', e)
    app.quit()
    return
  }
  createWindow(port)
  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port) })
})

// The server installs its own SIGINT/SIGTERM/SIGHUP/exit cleanup (killAllPtys) in-process, so quitting
// the app tears down agent PTYs. On macOS, keep the app alive when all windows close (standard).
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
