import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import type { BrowserHistoryClearRange } from '../../shared/types/browser.js'
import { browserService } from '../services/browser.service.js'
import { browserControlService } from '../services/browser-control.service.js'
import { pageMonitorService } from '../services/page-monitor.service.js'
import { sitePermissionService } from '../services/site-permission.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerBrowserIpc(): void {
  browserService.registerDownloadHandler()

  browserService.onDownloadsChanged((downloads) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.BROWSER_DOWNLOADS_CHANGED, downloads)
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_LIST_BOOKMARKS, () => {
    try {
      return ok(browserService.listBookmarks())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, (_e, url: string, title: string) => {
    try {
      return ok(browserService.addBookmark(url, title))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, (_e, id: string) => {
    try {
      return ok(browserService.removeBookmark(id))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_IS_BOOKMARKED, (_e, url: string) => {
    try {
      return ok(browserService.isBookmarked(url))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_RECORD_HISTORY, (_e, url: string, title: string) => {
    try {
      return ok(browserService.recordHistory(url, title))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_LIST_HISTORY, (_e, limit?: number) => {
    try {
      return ok(browserService.listHistory(limit))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_HISTORY, () => {
    try {
      browserService.clearHistory()
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_HISTORY_RANGE, (_e, range: BrowserHistoryClearRange) => {
    try {
      browserService.clearHistoryRange(range)
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_HISTORY, (_e, id: string) => {
    try {
      return ok(browserService.removeHistoryEntry(id))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_LIST_DOWNLOADS, () => {
    try {
      return ok(browserService.listDownloads())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS, () => {
    try {
      browserService.clearCompletedDownloads()
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_DOWNLOAD, (_e, id: string) => {
    try {
      return ok(browserService.removeDownloadRecord(id))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DATA, async () => {
    try {
      await browserService.clearBrowsingData()
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_SET_ACTIVE_WC, (_e, id: number | null) => {
    try {
      browserControlService.setActiveWebContents(id)
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_SYNC_TABS, (_e, tabs: unknown) => {
    try {
      browserControlService.syncTabs(Array.isArray(tabs) ? tabs as never : [])
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  // ── 页面变化监控 ─────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.BROWSER_MONITOR_LIST, () => {
    try {
      return ok(pageMonitorService.list())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_MONITOR_CREATE, (_e, url: string, title?: string, intervalMinutes?: number, aiAnalyze?: boolean) => {
    try {
      return ok(pageMonitorService.create(String(url ?? ''), title, intervalMinutes, Boolean(aiAnalyze)))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_MONITOR_SET_STATUS, (_e, id: string, status: 'active' | 'paused') => {
    try {
      pageMonitorService.setStatus(String(id ?? ''), status === 'paused' ? 'paused' : 'active')
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_MONITOR_REMOVE, (_e, id: string) => {
    try {
      pageMonitorService.remove(String(id ?? ''))
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  // ── 站点权限 ─────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.BROWSER_SITE_PERMISSIONS_LIST, () => {
    try {
      return ok(sitePermissionService.list())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /** 站点级 AI 操作授权：列出非默认策略 / 设置（'ask' 即恢复默认）。 */
  ipcMain.handle(IPC_CHANNELS.BROWSER_AGENT_POLICIES_LIST, () => {
    try {
      return ok(sitePermissionService.listAgentPolicies())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_AGENT_POLICY_SET, (_e, origin: string, policy: 'auto' | 'ask' | 'block') => {
    try {
      const clean = policy === 'auto' || policy === 'block' ? policy : 'ask'
      sitePermissionService.setAgentPolicy(String(origin ?? ''), clean)
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /** 清除站点权限记录：传 origin 清单个站点，不传清全部。 */
  ipcMain.handle(IPC_CHANNELS.BROWSER_SITE_PERMISSIONS_CLEAR, (_e, origin?: string) => {
    try {
      if (origin) sitePermissionService.clearSite(String(origin))
      else sitePermissionService.clearAll()
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
}
