// Electron main process — the desktop "app" form. It is a THIN supervisor: it ensures a Berth server
// is running (reusing an existing one, or spawning one in a SEPARATE utilityProcess), then points a
// BrowserWindow at it. The server NEVER runs on this main/UI thread, so a busy server can't freeze the
// window. The persistent-PTY-over-WS model carries over unchanged. CommonJS (.cjs) for the widest
// Electron compatibility; the core + discovery helpers are ESM, loaded via dynamic import().
const { app, BrowserWindow, shell, utilityProcess, dialog } = require('electron')
const path = require('node:path')

let mainWindow = null
let serverChild = null   // the utilityProcess we spawned, or null when we reused an external server
let quitting = false     // set in before-quit so a child exit during teardown isn't treated as a crash
let restarts = 0         // consecutive rapid crash-restarts (reset once a (re)start stays up a while)
let lastListenAt = 0     // when the current server last reported listening

// Canonical port: honour $PORT so both the CLI and the app agree on the same default.
const CANON_PORT = Number(process.env.PORT) || 7777
const CANON_HOST = '127.0.0.1'
const STABLE_MS = 30_000   // a server up this long resets the rapid-restart budget
const MAX_RAPID_RESTARTS = 3

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
      if (!msg) return
      if (msg.type === 'listening') { lastListenAt = Date.now(); if (!settled) { settled = true; resolve(msg.port) } }
      else if (msg.type === 'error' && !settled) { settled = true; reject(new Error(msg.message)) }
    })
    child.on('exit', (code) => {
      const wasCurrent = serverChild === child
      if (wasCurrent) serverChild = null
      if (!settled) { settled = true; reject(new Error(`Berth server process exited (${code}) before listening`)); return }
      // The server died AFTER it was serving — the window now points at a dead server. Supervise it
      // (respawn + reload) instead of leaving a frozen-looking UI with no recovery path.
      if (wasCurrent && !quitting) void superviseRestart()
    })
  })
}

// Respawn a crashed server and re-point the window, bounded so a server that crashes on boot can't
// spin forever. A server that stayed up past STABLE_MS counts as a fresh incident, not a rapid loop.
async function superviseRestart() {
  if (quitting) return
  restarts = (Date.now() - lastListenAt < STABLE_MS) ? restarts + 1 : 1
  if (restarts > MAX_RAPID_RESTARTS) {
    dialog.showErrorBox('Berth', 'The Berth server keeps crashing and could not be restarted. Please quit and relaunch Berth.')
    return
  }
  try {
    const port = await startServerProcess()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`http://127.0.0.1:${port}/app/`)
  } catch (e) {
    dialog.showErrorBox('Berth', 'The Berth server crashed and could not be restarted: ' + ((e && e.message) || e))
  }
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
  // macOS: re-create a window when the dock icon is clicked and none are open. Use the live server
  // port (a supervised restart may have moved it) rather than the captured one.
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port) })
})

// Tear down the server process WE spawned when the app quits (a reused external server is left alone),
// and WAIT for it to exit so its SIGTERM-driven killAllPtys sweep finishes — preserving the in-process
// model's guarantee of no orphaned agent subtrees. Bounded so quit never hangs.
app.on('before-quit', (e) => {
  if (!serverChild || quitting) return
  quitting = true
  e.preventDefault()
  const child = serverChild
  const finish = () => { try { app.exit(0) } catch { /* already exiting */ } }
  const timer = setTimeout(finish, 2500)
  child.once('exit', () => { clearTimeout(timer); finish() })
  try { child.kill() } catch { clearTimeout(timer); finish() }
})

// On macOS keep the app alive when all windows close (standard); elsewhere quit (which fires before-quit).
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
