// Electron main process — the desktop "app" form. It is a THIN launcher around the same core the CLI
// uses: it boots the compiled server (dist/server/index.js) on a free loopback port, then points a
// BrowserWindow at it. The persistent-PTY-over-WS model carries over unchanged. CommonJS (.cjs) for
// the widest Electron compatibility; the core is ESM, loaded via dynamic import().
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

let mainWindow = null

async function bootServer() {
  // dist/server/index.js is ESM; dynamic import() bridges from this CJS main.
  const serverEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js')
  const { start } = await import(serverEntry)
  // Port 0 = OS-assigned free port; loopback only (single-user, unauthenticated; /pty spawns CLIs).
  const { port } = await start(0, '127.0.0.1')
  return port
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
    port = await bootServer()
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
