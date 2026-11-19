import { app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { NativeImage } from 'electron'

// 延迟计算 dev 模式，避免模块顶层访问 electron.app。
// node 环境（vitest）下 app 为 undefined，视作 dev，保证被测模块可安全导入。
export const isDev = (): boolean => !app?.isPackaged

export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.mjs')
}

export function getRendererPath(): string {
  return join(__dirname, '../renderer/index.html')
}

export function getBuildAssetPath(...segments: string[]): string {
  // 打包后托盘等图标经 extraResources 落在 Resources/。macOS 的 icon.icns 由
  // electron-builder 按 mac.icon 写入同一位置，不要再放进 extraResources，否则硬链接会 EEXIST。
  // nativeImage 读不到 asar 内的图标。开发时用项目根 build/。
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
  return join(base, ...segments)
}

export function getWindowIconPath(): string {
  if (process.platform === 'win32') return getBuildAssetPath('icon.ico')
  if (process.platform === 'darwin') return getBuildAssetPath('icon.icns')
  return getBuildAssetPath('icon.png')
}

/** macOS dock icons should use the multi-size .icns asset, not the full-bleed PNG. */
export function getDockIcon(): NativeImage {
  if (process.platform === 'darwin') {
    const icns = nativeImage.createFromPath(getBuildAssetPath('icon.icns'))
    if (!icns.isEmpty()) return icns
  }
  return nativeImage.createFromPath(getBuildAssetPath('icon.png'))
}

export function getDockIconPath(): string {
  if (process.platform === 'darwin') return getBuildAssetPath('icon.icns')
  return getBuildAssetPath('icon.png')
}

export function getTrayIconPath(): string {
  if (process.platform === 'darwin') return getBuildAssetPath('trayTemplate.png')
  return getBuildAssetPath('tray.png')
}

export function getTrayIcon(): NativeImage {
  const icon = nativeImage.createFromPath(getTrayIconPath())
  if (!icon.isEmpty()) {
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    return icon
  }
  // 兜底用彩色 dock 图标时绝不能标记 template：macOS 的 Template Image 只看
  // alpha 通道，满铺的彩色图标会被渲染成一整块实心色（空白圆角方块）。
  return getDockIcon().resize({ width: 16, height: 16 })
}
