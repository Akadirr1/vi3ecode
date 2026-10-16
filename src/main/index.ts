import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { killAllPtys } from './pty'
import { stopAllRuns } from './team'
import { stopAllChats } from './chat'
import { loadShellPath } from './shellEnv'
import { stopAllFlows } from './flows'
import { startBrowserBridge, stopBrowserBridge } from './browserBridge'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0f12',
    title: 'vi3ecode',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The browser panel is a <webview>; will-attach-webview below strips anything powerful from it.
      webviewTag: true
    }
  })
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    if (!/^https?:\/\//.test(params.src || 'about:blank') && params.src !== 'about:blank') params.src = 'about:blank'
  })
  win.once('ready-to-show', () => win.show())
  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// The browser panel's webview may follow links and redirects, but only to web pages; popups load in place.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return
  contents.on('will-navigate', (e, url) => {
    if (!/^(https?:|about:blank)/i.test(url)) e.preventDefault()
  })
  contents.on('will-redirect', (e, url) => {
    if (!/^https?:/i.test(url)) e.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void contents.loadURL(url)
    return { action: 'deny' }
  })
})

// One instance per profile: a second one would rewrite the browser bridge token under the first one's engines.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  if (!primary) return
  // Pages in the browser panel get no camera, microphone, location, notifications or clipboard reads.
  const web = session.fromPartition('persist:vi3e-browser')
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen'])
  web.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  web.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  loadShellPath()
  registerIpc()
  startBrowserBridge()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopAllChats()
  stopAllRuns()
  stopAllFlows()
  stopBrowserBridge()
  killAllPtys()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
