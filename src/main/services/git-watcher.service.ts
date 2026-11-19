/**
 * git-watcher.service.ts — .git 目录监听（参考 VS Code git 扩展的 dotGit watcher）
 *
 * 监听当前工作区 `.git` 的关键变化（HEAD 切换、index 暂存、refs 更新、
 * merge/rebase 状态文件），debounce 后向所有窗口广播 WORKSPACE_GIT_CHANGED。
 * 由此，终端命令、Agent 工具、外部编辑器造成的仓库变化都会让 Git 面板
 * 自动刷新，而不是等用户手动点刷新。
 *
 * 噪声控制：
 * - *.lock（index.lock 等）是 git 自身写操作的瞬态文件，忽略。
 * - debounce 500ms 合并一次操作产生的连环事件（git commit 会连续改
 *   index/HEAD/refs/logs）。
 * - 读操作统一带 GIT_OPTIONAL_LOCKS=0（见 git-exec.ts），刷新本身不会
 *   再触发监听形成回环。
 */

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import { createLogger } from '../../shared/utils/log.js'
import { isDev } from '../app-env.js'

const DEBOUNCE_MS = 500

const logger = createLogger('main/git-watcher', {
  debugEnabled: isDev
})

/** 是否应忽略该文件事件（git 写操作的瞬态锁文件） */
function shouldIgnoreGitEvent(filename: string | null): boolean {
  if (!filename) return false
  return filename.endsWith('.lock')
}

export class GitWatcherService {
  private watchers: FSWatcher[] = []
  private watchedRoot: string | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 切换监听目标到指定工作区。
   * 非 Git 仓库（无 .git 目录）时仅停止旧监听。重复调用同一路径为 no-op。
   */
  async watch(rootPath: string): Promise<void> {
    if (this.watchedRoot === rootPath) return
    this.dispose()
    this.watchedRoot = rootPath

    const dotGit = join(rootPath, '.git')
    try {
      const info = await stat(dotGit)
      // worktree/submodule 的 .git 是文件而非目录，暂不监听（读链路不受影响）
      if (!info.isDirectory()) return
    } catch {
      return
    }

    const onEvent = (_event: string, filename: string | Buffer | null) => {
      const name = typeof filename === 'string' ? filename : filename?.toString() ?? null
      if (shouldIgnoreGitEvent(name)) return
      this.scheduleBroadcast()
    }

    try {
      // .git 根：HEAD / index / MERGE_HEAD / ORIG_HEAD 等状态文件
      this.watchers.push(watch(dotGit, onEvent))
      // refs 子树：分支/标签/远程引用更新（macOS/Windows 支持递归监听）
      this.watchers.push(watch(join(dotGit, 'refs'), { recursive: true }, onEvent))
      logger.info('watching .git', { rootPath })
    } catch (e) {
      logger.warn('failed to watch .git', { rootPath, error: String(e) })
      this.dispose()
    }
  }

  /** 停止监听并清理定时器 */
  dispose(): void {
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
    this.watchedRoot = null
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private scheduleBroadcast(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      logger.debug('broadcast git changed', { rootPath: this.watchedRoot })
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.WORKSPACE_GIT_CHANGED)
      }
    }, DEBOUNCE_MS)
  }
}

export const gitWatcherService = new GitWatcherService()

/** 仅测试使用 */
export const gitWatcherInternalsForTest = {
  shouldIgnoreGitEvent,
  DEBOUNCE_MS
}
