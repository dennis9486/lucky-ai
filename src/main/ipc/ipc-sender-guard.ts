import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { createLogger } from '../../shared/utils/log.js'

/**
 * IPC 来源守卫。
 *
 * 主窗口 sandbox:false 且开启 webviewTag（内嵌浏览器），渲染进程同时承载不受信任的
 * 网页内容。preload 桥暴露的 IPC 面很大（文件/终端/git/设置），一旦渲染侧被网页内容
 * 攻破，攻击者可尝试直接 invoke 任意通道。此模块在注册入口统一包掉 `ipcMain.handle`，
 * 只放行「应用窗口的主 frame + 应用自身 URL」的调用：
 *
 * - webview（内嵌浏览器页面）的 webContents 类型是 'webview'，一律拒绝——
 *   webview 不挂 preload，本就没有合法 IPC 用途；
 * - iframe 等子 frame 一律拒绝（只认 mainFrame）；
 * - 主 frame URL 必须是 file:（生产 loadFile）或 dev server 同源（开发 loadURL）。
 *
 * 纯逻辑与 electron 解耦（仅 type import），便于单测。
 */

const logger = createLogger('main/ipc-guard')

/** 解析 dev 渲染地址（electron-vite 注入的 ELECTRON_RENDERER_URL）为 origin；非法/缺失返回 null。 */
export function resolveDevRendererOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

/** 主 frame URL 是否属于应用自身（生产 file: / 开发 dev server 同源）。 */
export function isTrustedFrameUrl(url: string, devRendererOrigin: string | null): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    return devRendererOrigin !== null && parsed.origin === devRendererOrigin
  } catch {
    return false
  }
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent, devRendererOrigin: string | null): boolean {
  // 内嵌浏览器 webview 类型为 'webview'，应用窗口为 'window'
  if (event.sender.getType() !== 'window') return false
  // 只认主 frame：第三方 iframe 即使注入脚本也到不了 IPC
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  return isTrustedFrameUrl(frame.url, devRendererOrigin)
}

export interface IpcSenderGuardOptions {
  /** 开发模式渲染地址（process.env.ELECTRON_RENDERER_URL）；生产不传。 */
  devRendererUrl?: string
}

/**
 * 包掉 `ipcMain.handle`，为之后注册的所有 handler 统一加来源校验。
 * 必须在任何 IPC handler 注册之前调用（registerAllIpc 的第一行）。
 * 被拒绝的调用返回 IpcResult 失败形态，与各 handler 的错误路径一致。
 */
export function installIpcSenderGuard(ipc: IpcMain, options: IpcSenderGuardOptions = {}): void {
  const devOrigin = resolveDevRendererOrigin(options.devRendererUrl)
  const originalHandle = ipc.handle.bind(ipc)

  ipc.handle = ((channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    originalHandle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event, devOrigin)) {
        logger.warn('blocked ipc invoke from untrusted sender', {
          channel,
          senderType: event.sender.getType(),
          frameUrl: event.senderFrame?.url ?? null
        })
        return { success: false, error: 'IPC 调用被拒绝：不受信任的调用来源' }
      }
      return listener(event, ...args)
    })) as IpcMain['handle']
}
