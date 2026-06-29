// Electron main process — the desktop "app" form. It is a THIN supervisor: it ensures a Berth server
// is running (reusing an existing one, or spawning one in a SEPARATE utilityProcess), then points a
// BrowserWindow at it. The server NEVER runs on this main/UI thread, so a busy server can't freeze the
// window. The persistent-PTY-over-WS model carries over unchanged. CommonJS (.cjs) for the widest
// Electron compatibility; the core + discovery helpers are ESM, loaded via dynamic import().
const { app, BrowserWindow, shell, utilityProcess } = require('electron')
const path = require('node:path')

let mainWindow = null
let serverChild = null   // the utilityProcess we spawned, or null when we reused an external server

// Canonical port: honour $PORT so both the CLI and the app agree on the same default.
const CANON_PORT = Number(process.env.PORT) || 7777
const CANON_HOST = '127.0.0.1'

// Spawn the server in its own process (Electron utilityProcess). Resolves with the bound port once the
// child reports it listening. The server's start() prefers CANON_PORT and falls back to a free port if
// a non-Berth process holds it (recorded in ~/.berth/server.json either way, so the CLI can discover it).
function startServerProcess() {
  return new Promise((resolve, reject) => {
    const entry = path.join(__dirname, 'server-process.cjs')
    const child = utilityProcess.fork(entry, [], {
      env: { ...process.env, PORT: String(CANON_PORT), HOST: CANON_HOST },
      stdio: 'inherit',
    })
    serverChild = child
    let settled = false
    child.on('message', (msg) => {
      if (settled || !msg) return
      if (msg.type === 'listening') { settled = true; resolve(msg.port) }
      else if (msg.type === 'error') { settled = true; reject(new Error(msg.message)) }
    })
    child.on('exit', (code) => {
      if (serverChild === child) serverChild = null
      if (!settled) { settled = true; reject(new Error(`Berth server process exited (${code}) before listening`)) }
    })
  })
}

// 1) Reuse a Berth server already running — recorded in server.json on ANY port, or live on the
//    canonical port (whether the app or `berth start` came up first).
// 2) Otherwise spawn our own server in a SEPARATE process and use the port it binds.
async function resolveServer() {
  const { findReusableServer } = await import(path.join(__dirname, '..', 'dist', 'server-resolve.js'))
  const reusable = await findReusableServer({ host: CANON_HOST, port: CANON_PORT })
  if (reusable) return reusable.port
  return startServerProcess()
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

// Tear down the server process WE spawned when the app quits (a reused external server is left alone).
// The utilityProcess gets SIGTERM, which the server's own shutdown cleanup turns into killAllPtys.
app.on('before-quit', () => {
  if (serverChild) { try { serverChild.kill() } catch { /* already gone */ } serverChild = null }
})

// On macOS keep the app alive when all windows close (standard); elsewhere quit (which fires before-quit).
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
