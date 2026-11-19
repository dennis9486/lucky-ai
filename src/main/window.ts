import { BrowserWindow, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/ipc-channels.js'
import { createLogger } from '../shared/utils/log.js'
import { isDev, getPreloadPath, getRendererPath, getWindowIconPath } from './app-env.js'

let windowIdCounter = 0

let primaryWindow: BrowserWindow | null = null
const logger = createLogger('main/window', { debugEnabled: isDev })

function attachDevToolsSupport(win: BrowserWindow): void {
  if (!isDev()) return

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()
    const toggleDevTools =
      key === 'f12'
      || (input.meta && input.alt && key === 'i')
      || (input.control && input.shift && key === 'i')

    if (toggleDevTools) {
      event.preventDefault()
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    }
  })
}

export function createAppWindow(): BrowserWindow {
  windowIdCounter++
  logger.info('create window', { windowId: windowIdCounter })
  const win = new BrowserWindow({
    width: 1400,
    height: 875,
    minWidth: 1400,
    minHeight: 640,
    title: 'Lucky',
    icon: getWindowIconPath(),
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 13 } : undefined,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  attachDevToolsSupport(win)

  // 原生全屏状态推给渲染进程（渲染层据此隐藏为红绿灯预留的空白标题栏）
  const sendFullscreen = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, win.isFullScreen())
  }
  win.on('enter-full-screen', sendFullscreen)
  win.on('leave-full-screen', sendFullscreen)
  win.webContents.on('did-finish-load', sendFullscreen)

  win.on('ready-to-show', () => {
    logger.debug('window ready to show', { windowId: win.id })
    win.show()
    if (isDev()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(normalizeExternalUrl(url))
    } catch (error) {
      logger.warn('blocked external window request', { url, error })
    }
    return { action: 'deny' }
  })

  if (isDev() && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(getRendererPath())
  }

  primaryWindow = win
  win.on('closed', () => {
    logger.info('window closed', { windowId: win.id })
    if (primaryWindow === win) primaryWindow = null
  })

  return win
}

export function createNewWindow(): BrowserWindow {
  return createAppWindow()
}

export function getPrimaryWindow(): BrowserWindow | null {
  return primaryWindow
}

export { windowIdCounter }

function normalizeExternalUrl(raw: string): string {
  const parsed = new URL(raw)
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error(`Blocked external URL protocol: ${parsed.protocol}`)
  }
  return parsed.href
}
