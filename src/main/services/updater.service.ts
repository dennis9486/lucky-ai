import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { createLogger } from '../../shared/utils/log.js'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { UpdaterPhase, UpdaterState } from '../../shared/types/updater.js'

// electron-updater 以 CommonJS 默认导出，ESM 下需从 default 取 autoUpdater
const { autoUpdater } = electronUpdater
const logger = createLogger('main/updater')

/** 启动后首次检查的延迟（让窗口先就绪），以及之后的周期检查间隔 */
const INITIAL_CHECK_DELAY_MS = 8_000
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h

/**
 * 自动更新服务（基于 electron-updater，feed 由打包时的 publish 配置注入 app-update.yml）。
 *
 * 设计要点（严谨/通用）：
 * - 仅在「已打包」环境启用；开发态没有 app-update.yml，直接置为 disabled，避免 autoUpdater 抛错。
 * - 维护单一 UpdaterState，所有 autoUpdater 事件归一为状态变更并广播给渲染端（UI 纯被动展示）。
 * - autoDownload 默认开启：发现更新即后台下载，下载完成提示用户重启安装（autoInstallOnAppQuit 兜底）。
 * - 所有对 autoUpdater 的调用都吞掉异常并落到 error 状态，绝不让更新流程影响主流程。
 */
class UpdaterService {
  private getWindow: (() => BrowserWindow | null) | null = null
  private periodicTimer: ReturnType<typeof setInterval> | null = null
  private listenersBound = false

  private state: UpdaterState = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    autoDownload: true
  }

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow

    if (!app.isPackaged) {
      // 开发态：无更新元数据，标记为 disabled 并直接返回
      this.patch({ phase: 'disabled' })
      logger.info('auto-update disabled in dev / unpackaged build')
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    this.bindListeners()

    // 启动后延迟首检 + 周期检查（静默：无更新不打扰）
    setTimeout(() => void this.check(false), INITIAL_CHECK_DELAY_MS)
    this.periodicTimer = setInterval(() => void this.check(false), PERIODIC_CHECK_INTERVAL_MS)
  }

  getState(): UpdaterState {
    return this.state
  }

  /** 手动/自动触发检查；manual=true 时即便出错也保留可见错误供 UI 展示 */
  async check(manual: boolean): Promise<UpdaterState> {
    if (this.state.phase === 'disabled') return this.state
    if (this.state.phase === 'downloading' || this.state.phase === 'downloaded') return this.state
    try {
      this.patch({ phase: 'checking', error: undefined, lastCheckedAt: Date.now() })
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.fail(error, manual)
    }
    return this.state
  }

  /** autoDownload 关闭时由用户手动触发下载 */
  async download(): Promise<UpdaterState> {
    if (this.state.phase === 'disabled') return this.state
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.fail(error, true)
    }
    return this.state
  }

  /** 退出并安装已下载的更新 */
  install(): void {
    if (this.state.phase !== 'downloaded') return
    // isSilent=false 显示安装进度；isForceRunAfter=true 安装后自动重启
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  dispose(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer)
    this.periodicTimer = null
  }

  private bindListeners(): void {
    if (this.listenersBound) return
    this.listenersBound = true

    autoUpdater.on('checking-for-update', () => this.patch({ phase: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('update available', { version: info.version })
      this.patch({ phase: 'available', ...this.fromInfo(info) })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.patch({ phase: 'not-available', version: info.version })
    })
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.patch({
        phase: 'downloading',
        progress: {
          percent: Math.round(progress.percent),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        }
      })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('update downloaded', { version: info.version })
      this.patch({ phase: 'downloaded', progress: undefined, ...this.fromInfo(info) })
    })
    autoUpdater.on('error', (error: Error) => this.fail(error, false))
  }

  private fromInfo(info: UpdateInfo): Partial<UpdaterState> {
    return {
      version: info.version,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    }
  }

  private fail(error: unknown, visible: boolean): void {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('auto-update error', { message, visible })
    this.patch({ phase: 'error', error: message })
  }

  private patch(partial: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...partial }
    const win = this.getWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.UPDATER_STATUS, this.state)
    }
  }
}

export const updaterService = new UpdaterService()
export type { UpdaterPhase }
