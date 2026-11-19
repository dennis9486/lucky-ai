import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'

export function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('URL 不能为空')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`URL 无效: ${raw}`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`内嵌浏览器仅支持 http/https: ${parsed.protocol}`)
  }

  return parsed.href
}

class BrowserNavigationService {
  openUrl(raw: string): string {
    const url = normalizeBrowserUrl(raw)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.BROWSER_OPEN_URL, url)
    }
    return url
  }
}

export const browserNavigationService = new BrowserNavigationService()
