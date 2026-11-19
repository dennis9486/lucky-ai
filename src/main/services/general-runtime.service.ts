import {
  globalShortcut,
  Menu,
  nativeImage,
  powerSaveBlocker,
  Tray
} from 'electron'
import type { Tray as TrayInstance, MenuItemConstructorOptions } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { GeneralAppSettings } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import { getTrayIcon } from '../app-env.js'
import { createAppWindow, getPrimaryWindow } from '../window.js'

const logger = createLogger('main/general-runtime')
const POPUP_SHORTCUT = 'CommandOrControl+Shift+Space'

export class GeneralRuntimeService {
  private preventSleepBlockerId: number | null = null
  private tray: TrayInstance | null = null
  private popupShortcutRegistered = false

  apply(settings: GeneralAppSettings): void {
    this.setPreventSleep(settings.preventSleepWhileRunning)
    this.setTrayVisible(settings.showInMenuBar)
    this.setPopupShortcut(settings.popupShortcutEnabled)
  }

  dispose(): void {
    this.setPreventSleep(false)
    this.setPopupShortcut(false)
    this.tray?.destroy()
    this.tray = null
  }

  private setPreventSleep(enabled: boolean): void {
    if (enabled) {
      if (this.preventSleepBlockerId !== null) return
      this.preventSleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      logger.info('prevent sleep enabled', { id: this.preventSleepBlockerId })
      return
    }
    if (this.preventSleepBlockerId === null) return
    const id = this.preventSleepBlockerId
    this.preventSleepBlockerId = null
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id)
    }
    logger.info('prevent sleep disabled', { id })
  }

  private setTrayVisible(enabled: boolean): void {
    if (!enabled) {
      this.tray?.destroy()
      this.tray = null
      return
    }
    if (this.tray) return
    const icon = getTrayIcon()
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    this.tray.setToolTip('Lucky')
    this.tray.setContextMenu(Menu.buildFromTemplate(this.buildTrayMenu()))
    // 左键点击直接呼出/聚焦窗口；右键弹出上面这份 AI IDE 菜单（各平台默认行为）。
    this.tray.on('click', () => this.showWindow())
  }

  /** AI IDE 相关的托盘菜单：窗口、对话、导航、设置与更新。 */
  private buildTrayMenu(): MenuItemConstructorOptions[] {
    return [
      { label: 'Show Lucky', click: () => this.showWindow() },
      { type: 'separator' },
      { label: 'New Chat', click: () => this.sendMenuCommand('new-chat') },
      { label: 'Quick Chat', accelerator: POPUP_SHORTCUT, click: () => this.sendMenuCommand('quick-chat') },
      { label: 'Command Palette', click: () => this.sendMenuCommand('command-palette') },
      { type: 'separator' },
      { label: 'Code Editor', click: () => this.sendMenuCommand('show-code') },
      { label: 'Browser', click: () => this.sendMenuCommand('show-browser') },
      { label: 'Scheduled Tasks', click: () => this.sendMenuCommand('show-scheduled') },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => this.sendMenuCommand('open-settings') },
      // 懒加载 updater：electron-updater 在模块顶层会实例化 autoUpdater（测试环境无 electron app 会崩），
      // 仅在用户点击时按需载入，避免把它带进 settings.service 的静态依赖图。
      { label: 'Check for Updates…', click: () => { void this.checkForUpdates() } },
      { type: 'separator' },
      { label: 'Quit Lucky', role: 'quit' }
    ]
  }

  private setPopupShortcut(enabled: boolean): void {
    if (!enabled) {
      if (this.popupShortcutRegistered) {
        globalShortcut.unregister(POPUP_SHORTCUT)
        this.popupShortcutRegistered = false
      }
      return
    }
    if (this.popupShortcutRegistered) return
    this.popupShortcutRegistered = globalShortcut.register(POPUP_SHORTCUT, () => {
      this.sendMenuCommand('quick-chat')
    })
    if (!this.popupShortcutRegistered) {
      logger.warn('popup shortcut registration failed', { shortcut: POPUP_SHORTCUT })
    }
  }

  private async checkForUpdates(): Promise<void> {
    this.showWindow()
    try {
      const { updaterService } = await import('./updater.service.js')
      await updaterService.check(true)
    } catch (error) {
      logger.debug('tray check for updates failed', { error })
    }
  }

  private showWindow() {
    const win = getPrimaryWindow() ?? createAppWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }

  private sendMenuCommand(command: string): void {
    const win = this.showWindow()
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send(IPC_CHANNELS.APP_MENU_COMMAND, command)
      })
      return
    }
    win.webContents.send(IPC_CHANNELS.APP_MENU_COMMAND, command)
  }
}

export const generalRuntimeService = new GeneralRuntimeService()
