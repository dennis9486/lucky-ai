/** 自动更新（electron-updater）的跨进程类型定义 */

export type UpdaterPhase =
  | 'idle'           // 空闲（尚未检查）
  | 'checking'       // 正在检查
  | 'available'      // 发现新版本（autoDownload 关时等待用户下载）
  | 'not-available'  // 已是最新
  | 'downloading'    // 正在下载
  | 'downloaded'     // 下载完成，待重启安装
  | 'error'          // 出错
  | 'disabled'       // 当前环境不支持（开发态 / 未打包）

export interface UpdaterProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdaterState {
  phase: UpdaterPhase
  /** 当前已安装版本 */
  currentVersion: string
  /** 可用 / 已下载更新的版本号 */
  version?: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
  progress?: UpdaterProgress
  error?: string
  /** 是否自动下载（决定 UI 是否需要“下载”按钮） */
  autoDownload: boolean
  /** 最近一次检查时间戳 */
  lastCheckedAt?: number
}
