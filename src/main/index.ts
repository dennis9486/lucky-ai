import { app, BrowserWindow, ipcMain, shell, nativeTheme, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { IPC_CHANNELS } from '../shared/constants/ipc-channels.js'
import { createLogger } from '../shared/utils/log.js'
import { createAppWindow, createNewWindow, getPrimaryWindow } from './window.js'
import { registerWorkspaceIpc, registerFileIpc } from './ipc/workspace.ipc.js'
import { registerExtensionIpc } from './ipc/extension.ipc.js'
import { registerFormatterIpc } from './ipc/formatter.ipc.js'
import { registerTerminalIpc } from './ipc/terminal.ipc.js'
import { registerSettingsIpc } from './ipc/ai.ipc.js'
import { registerAgentIpc } from './ipc/agent.ipc.js'
import { registerAgentRuntimeIpc } from './ipc/agent-runtime.ipc.js'
import { registerConversationIpc } from './ipc/conversation.ipc.js'
import { registerMemoryIpc } from './ipc/memory.ipc.js'
import { registerChronicleIpc } from './ipc/chronicle.ipc.js'
import { registerScheduledTaskIpc } from './ipc/scheduled-task.ipc.js'
import { scheduledTaskScheduler } from './services/scheduled-task-scheduler.js'
import { pageMonitorService } from './services/page-monitor.service.js'
import { sitePermissionService } from './services/site-permission.service.js'
import { registerBrowserIpc } from './ipc/browser.ipc.js'
import { registerLspIpc } from './ipc/lsp.ipc.js'
import { registerUpdaterIpc } from './ipc/updater.ipc.js'
import { updaterService } from './services/updater.service.js'
import { agentRuntimeService } from './services/agent-runtime.service.js'
import { DatabaseService } from './db/database.service.js'
import { settingsService } from './services/settings.service.js'
import { generalRuntimeService } from './services/general-runtime.service.js'
import { diagnosticsService, type RendererErrorReport } from './services/diagnostics.service.js'
import { workspaceService } from './services/workspace.service.js'
import { installApplicationMenu } from './application-menu.js'
import { attachWebviewContextMenu } from './browser-context-menu.js'
import type { IpcResult, PastedImageInput, SavedAttachment } from '../shared/types/ipc.js'
import type { ThemeMode } from '../shared/types/theme.js'
import { getDockIcon, isDev } from './app-env.js'
import { installIpcSenderGuard } from './ipc/ipc-sender-guard.js'
import { browserControlService } from './services/browser-control.service.js'

const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}
const logger = createLogger('main/app')

// E2E 测试接缝：隔离 userData（数据库/设置/日志），绝不触碰真实用户数据。
// 必须在任何 getPath('userData') 消费者（DatabaseService 等）之前设置。
if (process.env.LUCKY_USER_DATA_DIR) {
  app.setPath('userData', process.env.LUCKY_USER_DATA_DIR)
}

// E2E 测试接缝：暴露主进程服务供 Playwright app.evaluate 驱动
// （AI 浏览器操作链路 snapshot/fill/click 的端到端验证）。仅测试环境生效。
if (process.env.LUCKY_E2E_HOOKS === '1') {
  ;(globalThis as Record<string, unknown>).__luckyE2E = {
    get browserControlService() {
      return browserControlService
    }
  }
}

// 可观测性：落盘日志 + 本地崩溃转储（越早越好，尤其 crashReporter 需在 app ready 前启动）
diagnosticsService.init()

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', { error })
})

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { reason })
})

// 渲染进程 / GPU / 工具子进程崩溃
app.on('render-process-gone', (_event, webContents, details) => {
  logger.error('render process gone', { reason: details.reason, exitCode: details.exitCode, url: webContents.getURL() })
})
app.on('child-process-gone', (_event, details) => {
  logger.error('child process gone', { type: details.type, reason: details.reason, exitCode: details.exitCode })
})

function syncNativeTheme(mode?: ThemeMode): void {
  nativeTheme.themeSource = mode ?? 'system'
}

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

function registerAppIpc(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => ok(app.getVersion()))
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_e, url: string) => {
    try {
      await shell.openExternal(normalizeExternalUrl(url))
      return ok(undefined)
    } catch (e) {
      logger.warn('open external failed', { url, error: e })
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_PATH, async (_e, path: string) => {
    try {
      const error = await shell.openPath(path)
      if (error) return fail(error)
      return ok(undefined)
    } catch (e) {
      logger.warn('open path failed', { path, error: e })
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle(IPC_CHANNELS.APP_SHOW_ITEM_IN_FOLDER, (_e, path: string) => {
    try {
      shell.showItemInFolder(path)
      return ok(undefined)
    } catch (e) {
      logger.warn('show item in folder failed', { path, error: e })
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle(IPC_CHANNELS.APP_SAVE_PASTED_IMAGE, async (_e, input: PastedImageInput) => {
    try {
      const saved = await savePastedImage(input)
      return ok(saved)
    } catch (e) {
      logger.warn('save pasted image failed', {
        mimeType: input.mimeType,
        name: input.name,
        error: e
      })
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_REPORT_ERROR, (_e, report: RendererErrorReport) => {
    diagnosticsService.recordRendererError(report)
    return ok(undefined)
  })
  ipcMain.handle(IPC_CHANNELS.WINDOW_CREATE, () => {
    createNewWindow()
    return ok(undefined)
  })
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_FULLSCREEN, (event, fullscreen: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setFullScreen(Boolean(fullscreen))
    return ok(undefined)
  })
}

async function savePastedImage(input: PastedImageInput): Promise<SavedAttachment> {
  const mimeType = input.mimeType.toLowerCase()
  const ext = IMAGE_EXT_BY_MIME[mimeType]
  if (!ext) throw new Error(`不支持的图片类型: ${input.mimeType}`)

  const data = Buffer.from(input.data)
  if (!data.length) throw new Error('图片内容为空')
  if (data.byteLength > MAX_PASTED_IMAGE_BYTES) throw new Error('图片过大，无法粘贴')

  // 优先存到工作区内（.lucky/attachments），这样 agent 的 Read/Bash 等工作区沙箱工具也能读取该图片；
  // 未打开工作区时回退到 userData。
  const ws = workspaceService.getWorkspace()
  const dir = ws
    ? path.join(ws.rootPath, '.lucky', 'attachments')
    : path.join(app.getPath('userData'), 'attachments', 'pasted-images')
  await mkdir(dir, { recursive: true })
  const safeBase = sanitizeAttachmentName(input.name ?? `pasted-image.${ext}`).replace(/\.[^.]+$/, '')
  const name = `${safeBase || 'pasted-image'}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  const filePath = path.join(dir, name)
  await writeFile(filePath, data)
  return { path: filePath, name, kind: 'image', mimeType }
}

function sanitizeAttachmentName(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function normalizeExternalUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`URL 无效: ${raw}`)
  }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error(`不允许打开的外部链接协议: ${parsed.protocol}`)
  }
  return parsed.href
}

const WEBVIEW_PARTITION = 'persist:lucky-ai-browser'

function configureWebviewSecurity(): void {
  sitePermissionService.init(getPrimaryWindow)
  // 按站点权限：首次询问并记住（摄像头/麦克风/定位/通知/剪贴板读取），其余保守拒绝
  session.fromPartition(WEBVIEW_PARTITION).setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = (() => {
      try {
        return new URL(details.requestingUrl || wc.getURL()).origin
      } catch {
        return ''
      }
    })()
    if (!origin) {
      callback(false)
      return
    }
    void sitePermissionService.decide(origin, permission).then(callback).catch(() => callback(false))
  })

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    // 不在系统层弹新 OS 窗口；改为把 target=_blank / window.open 的 http(s) 请求
    // 转发给宿主渲染进程，在内嵌浏览器里以“新标签”打开（对齐主流浏览器）。
    contents.setWindowOpenHandler(({ url }) => {
      const host = contents.hostWebContents
      if (host && !host.isDestroyed() && /^https?:\/\//i.test(url)) {
        host.send(IPC_CHANNELS.BROWSER_OPEN_URL_IN_NEW_TAB, url)
      }
      return { action: 'deny' }
    })
    // Chrome 风格右键菜单（导航/链接/图片/文本/检查元素）
    attachWebviewContextMenu(contents)
  })
}

function registerAllIpc(): void {
  logger.info('register ipc handlers')
  // 必须先于一切 ipcMain.handle 注册：统一拒绝 webview/子 frame/外部 origin 的 IPC 调用
  installIpcSenderGuard(ipcMain, {
    devRendererUrl: isDev() ? process.env.ELECTRON_RENDERER_URL : undefined
  })
  configureWebviewSecurity()
  registerAppIpc()
  registerWorkspaceIpc()
  registerFileIpc()
  registerFormatterIpc()
  registerExtensionIpc()
  registerTerminalIpc()
  registerSettingsIpc()
  registerAgentIpc()
  registerAgentRuntimeIpc(getPrimaryWindow)
  registerConversationIpc()
  registerMemoryIpc()
  registerChronicleIpc()
  registerScheduledTaskIpc(getPrimaryWindow)
  registerBrowserIpc()
  registerLspIpc(getPrimaryWindow)
  registerUpdaterIpc(getPrimaryWindow)
}

app.whenReady().then(async () => {
  logger.info('app ready, bootstrap start')
  if (process.platform === 'darwin') {
    // 空图会把 dock 图标清成默认 Electron 图标；宁可不设，让 .app bundle 的图标生效
    const dockIcon = getDockIcon()
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
    else logger.warn('dock icon asset missing, keeping bundle icon')
  }
  const settings = await settingsService.getSettings()
  syncNativeTheme(settings.theme?.mode)
  generalRuntimeService.apply(settings.general)
  DatabaseService.getInstance()
  registerAllIpc()
  installApplicationMenu({ professionalMode: settings.professionalMode })
  createAppWindow()
  logger.info('bootstrap complete', {
    themeMode: settings.theme?.mode ?? 'system'
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('reactivate app, recreating window')
      createAppWindow()
    }
  })
}).catch((error) => {
  logger.error('bootstrap failed', { error })
})

app.on('window-all-closed', () => {
  logger.info('all windows closed', { platform: process.platform })
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  logger.info('app will quit, closing database')
  generalRuntimeService.dispose()
  updaterService.dispose()
  agentRuntimeService.stop()
  scheduledTaskScheduler.stop()
  pageMonitorService.stop()
  DatabaseService.close()
})
