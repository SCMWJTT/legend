import { app, BrowserWindow, ipcMain, net, protocol, screen, Menu } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { Api, loadPrefs, savePrefs } from './api'
import { thumbPath } from './services/thumbs'

protocol.registerSchemesAsPrivileged([
  { scheme: 'legend-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let win: BrowserWindow | null = null
const api = new Api(() => win)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function createWindow(): void {
  const prefs = loadPrefs()
  const b = prefs.bounds
  const visible = b && screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
  win = new BrowserWindow({
    width: visible ? b!.width : 1480,
    height: visible ? b!.height : 920,
    x: visible ? b!.x : undefined,
    y: visible ? b!.y : undefined,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0e0f11',
    title: 'Legend',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0f11', symbolColor: '#9a9ca3', height: 38 },
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })
  if (visible && b!.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

  const saveBounds = (): void => {
    if (!win) return
    const p = loadPrefs()
    p.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    savePrefs(p)
  }
  win.on('close', saveBounds)
  win.on('closed', () => (win = null))

  // No navigation away from the app; external links open in the browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Test harness: LEGEND_SHOT=file.png [LEGEND_SHOT_JS=script.js] captures the window and quits.
  const shot = process.env.LEGEND_SHOT
  if (shot) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      await wait(Number(process.env.LEGEND_SHOT_DELAY ?? 2500))
      const js = process.env.LEGEND_SHOT_JS
      if (js) {
        const fsm = await import('fs')
        try {
          const r = await win!.webContents.executeJavaScript(fsm.readFileSync(js, 'utf8'))
          if (r) console.log('[shot-js]', typeof r === 'string' ? r : JSON.stringify(r))
        } catch (e) {
          console.log('[shot-js error]', (e as Error).message)
        }
        await wait(Number(process.env.LEGEND_SHOT_AFTER ?? 1500))
      }
      const img = await win!.webContents.capturePage()
      ;(await import('fs')).writeFileSync(shot, img.toPNG())
      app.quit()
    })
    win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg))
  }

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // legend-thumb://g/123?v=4  -> cached grid thumbnail;  legend-thumb://p/123 -> large preview
  protocol.handle('legend-thumb', (req) => {
    const u = new URL(req.url)
    const kind = u.hostname === 'p' ? 'p' : 'g'
    const id = Number(u.pathname.replace(/\//g, ''))
    if (!api.lib || !Number.isFinite(id)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(thumbPath(api.lib.dir, id, kind)).toString())
  })

  ipcMain.handle('legend', async (_e, method: string, args: unknown[]) => {
    const fn = (api as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function' || method.startsWith('_') || ['constructor', 'need', 'act', 'send', 'attach'].includes(method)) {
      throw new Error(`Unknown request ${method}`)
    }
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown).apply(api, args) }
    } catch (e) {
      api.lib?.log(`Error in ${method}: ${(e as Error).stack ?? e}`)
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.on('window', (_e, cmd: string) => {
    if (cmd === 'devtools') win?.webContents.toggleDevTools()
    if (cmd === 'reload') win?.webContents.reload()
  })

  // Re-open the last library automatically; if that fails the welcome screen offers it.
  api.tryOpenLast()
  createWindow()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  api.shutdown().finally(() => app.exit(0))
})

app.on('window-all-closed', () => app.quit())
