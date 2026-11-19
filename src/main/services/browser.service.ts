import { randomUUID } from 'node:crypto'
import { app, Notification, session, type DownloadItem } from 'electron'
import { extname, join, basename } from 'node:path'
import type {
  BrowserBookmark,
  BrowserDownload,
  BrowserDownloadStatus,
  BrowserHistoryClearRange,
  BrowserHistoryEntry
} from '../../shared/types/browser.js'
import { DatabaseService } from '../db/database.service.js'

const PARTITION = 'persist:lucky-ai-browser'
/** 高危下载扩展名（可执行/脚本/安装包） */
const RISKY_DOWNLOAD_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.scr', '.ps1',
  '.dmg', '.pkg', '.app',
  '.sh', '.run', '.deb', '.rpm', '.appimage',
  '.jar', '.vbs', '.js'
])
const MAX_HISTORY = 500

interface BookmarkRow {
  id: string
  url: string
  title: string
  created_at: number
}

interface HistoryRow {
  id: string
  url: string
  title: string
  visited_at: number
}

interface DownloadRow {
  id: string
  url: string
  filename: string
  save_path: string
  total_bytes: number
  received_bytes: number
  status: BrowserDownloadStatus
  started_at: number
  completed_at: number | null
}

class BrowserService {
  private downloadListeners = new Set<(downloads: BrowserDownload[]) => void>()
  private registered = false

  private get db() {
    return DatabaseService.getInstance().db
  }

  registerDownloadHandler(): void {
    if (this.registered) return
    this.registered = true

    app.whenReady().then(() => {
      const ses = session.fromPartition(PARTITION)
      ses.on('will-download', (_event, item) => {
        void this.handleDownload(item)
      })
    })
  }

  /**
   * 高危下载提示：可执行/脚本/安装包类文件弹原生通知警示来源。
   * 只提示不拦截——下载意图可能来自用户本人；拦截决策留给用户。
   */
  private warnIfRiskyDownload(filename: string, url: string): void {
    if (!RISKY_DOWNLOAD_EXTENSIONS.has(extname(filename).toLowerCase())) return
    // node 测试环境下 electron Notification 为 undefined
    if (!Notification?.isSupported?.()) return
    new Notification({
      title: `下载了可执行文件：${filename}`,
      body: `来源 ${url.slice(0, 120)}\n运行前请确认来源可信。`
    }).show()
  }

  private notifyDownloads(): void {
    const list = this.listDownloads()
    for (const listener of this.downloadListeners) listener(list)
  }

  onDownloadsChanged(listener: (downloads: BrowserDownload[]) => void): () => void {
    this.downloadListeners.add(listener)
    return () => this.downloadListeners.delete(listener)
  }

  private handleDownload(item: DownloadItem): void {
    const id = randomUUID()
    const filename = item.getFilename()
    const savePath = createDownloadPath(filename)
    item.setSavePath(savePath)
    this.warnIfRiskyDownload(filename, item.getURL())

    this.db
      .prepare(
        `INSERT INTO browser_downloads
          (id, url, filename, save_path, total_bytes, received_bytes, status, started_at)
         VALUES (?, ?, ?, ?, ?, 0, 'progressing', ?)`
      )
      .run(id, item.getURL(), filename, savePath, item.getTotalBytes(), Date.now())

    item.on('updated', () => {
      const received = item.getReceivedBytes()
      const total = item.getTotalBytes()
      this.db
        .prepare(`UPDATE browser_downloads SET received_bytes = ?, total_bytes = ? WHERE id = ?`)
        .run(received, total, id)
      this.notifyDownloads()
    })

    item.once('done', (_event, state) => {
      const status: BrowserDownloadStatus =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.db
        .prepare(
          `UPDATE browser_downloads SET status = ?, completed_at = ?, save_path = ? WHERE id = ?`
        )
        .run(status, Date.now(), item.getSavePath(), id)
      this.notifyDownloads()
    })

    this.notifyDownloads()
  }

  listBookmarks(): BrowserBookmark[] {
    const rows = this.db
      .prepare(`SELECT * FROM browser_bookmarks ORDER BY created_at DESC`)
      .all() as BookmarkRow[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      createdAt: r.created_at
    }))
  }

  addBookmark(url: string, title: string): BrowserBookmark {
    const safeUrl = normalizeBrowserUrl(url)
    const safeTitle = normalizeTitle(title, safeUrl)
    const existing = this.db
      .prepare(`SELECT id FROM browser_bookmarks WHERE url = ?`)
      .get(safeUrl) as { id: string } | undefined
    if (existing) {
      this.db.prepare(`UPDATE browser_bookmarks SET title = ? WHERE id = ?`).run(safeTitle, existing.id)
      return this.listBookmarks().find((b) => b.id === existing.id)!
    }
    const bookmark: BrowserBookmark = {
      id: randomUUID(),
      url: safeUrl,
      title: safeTitle,
      createdAt: Date.now()
    }
    this.db
      .prepare(`INSERT INTO browser_bookmarks (id, url, title, created_at) VALUES (?, ?, ?, ?)`)
      .run(bookmark.id, bookmark.url, bookmark.title, bookmark.createdAt)
    return bookmark
  }

  removeBookmark(id: string): boolean {
    return this.db.prepare(`DELETE FROM browser_bookmarks WHERE id = ?`).run(id).changes > 0
  }

  isBookmarked(url: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM browser_bookmarks WHERE url = ?`).get(normalizeBrowserUrl(url)))
  }

  recordHistory(url: string, title: string): BrowserHistoryEntry {
    const safeUrl = normalizeBrowserUrl(url)
    const safeTitle = normalizeTitle(title, safeUrl)
    this.db.prepare(`DELETE FROM browser_history WHERE url = ?`).run(safeUrl)
    const entry: BrowserHistoryEntry = {
      id: randomUUID(),
      url: safeUrl,
      title: safeTitle,
      visitedAt: Date.now()
    }
    this.db
      .prepare(`INSERT INTO browser_history (id, url, title, visited_at) VALUES (?, ?, ?, ?)`)
      .run(entry.id, entry.url, entry.title, entry.visitedAt)

    const count = this.db.prepare(`SELECT COUNT(*) AS c FROM browser_history`).get() as { c: number }
    if (count.c > MAX_HISTORY) {
      this.db.prepare(
        `DELETE FROM browser_history WHERE id IN (
          SELECT id FROM browser_history ORDER BY visited_at ASC LIMIT ?
        )`
      ).run(count.c - MAX_HISTORY)
    }
    return entry
  }

  listHistory(limit = 100): BrowserHistoryEntry[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 100), 1), MAX_HISTORY)
    const rows = this.db
      .prepare(`SELECT * FROM browser_history ORDER BY visited_at DESC LIMIT ?`)
      .all(safeLimit) as HistoryRow[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      visitedAt: r.visited_at
    }))
  }

  clearHistory(): void {
    this.db.prepare(`DELETE FROM browser_history`).run()
  }

  clearHistoryRange(range: BrowserHistoryClearRange): void {
    if (range === 'all') {
      this.clearHistory()
      return
    }
    const now = Date.now()
    const spans: Record<Exclude<BrowserHistoryClearRange, 'all'>, number> = {
      lastHour: 60 * 60 * 1000,
      lastDay: 24 * 60 * 60 * 1000,
      lastWeek: 7 * 24 * 60 * 60 * 1000,
      lastFourWeeks: 28 * 24 * 60 * 60 * 1000
    }
    this.db.prepare(`DELETE FROM browser_history WHERE visited_at >= ?`).run(now - spans[range])
  }

  removeHistoryEntry(id: string): boolean {
    return this.db.prepare(`DELETE FROM browser_history WHERE id = ?`).run(id).changes > 0
  }

  listDownloads(): BrowserDownload[] {
    const rows = this.db
      .prepare(`SELECT * FROM browser_downloads ORDER BY started_at DESC LIMIT 50`)
      .all() as DownloadRow[]
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      filename: r.filename,
      savePath: r.save_path,
      totalBytes: r.total_bytes,
      receivedBytes: r.received_bytes,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at ?? undefined
    }))
  }

  clearCompletedDownloads(): void {
    this.db
      .prepare(`DELETE FROM browser_downloads WHERE status IN ('completed', 'cancelled', 'interrupted')`)
      .run()
    this.notifyDownloads()
  }

  removeDownloadRecord(id: string): boolean {
    const changed = this.db.prepare(`DELETE FROM browser_downloads WHERE id = ?`).run(id).changes > 0
    if (changed) this.notifyDownloads()
    return changed
  }

  /** 清除浏览数据：历史 + 下载记录 + 分区的缓存/Cookie/本地存储。 */
  async clearBrowsingData(): Promise<void> {
    this.clearHistory()
    this.db.prepare(`DELETE FROM browser_downloads`).run()
    this.notifyDownloads()
    const ses = session.fromPartition(PARTITION)
    await ses.clearCache()
    await ses.clearStorageData()
  }
}

export const browserService = new BrowserService()

function normalizeBrowserUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`URL 无效: ${raw}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`浏览器仅支持 http/https 页面: ${parsed.protocol}`)
  }
  parsed.hash = ''
  return parsed.href
}

function normalizeTitle(title: string, fallbackUrl: string): string {
  const clean = title.trim().replace(/\s+/g, ' ')
  if (clean) return clean.slice(0, 200)
  try {
    return new URL(fallbackUrl).hostname
  } catch {
    return fallbackUrl
  }
}

function createDownloadPath(filename: string): string {
  const downloads = app.getPath('downloads')
  const cleanName = basename(filename || 'download')
  const ext = extname(cleanName)
  const base = ext ? cleanName.slice(0, -ext.length) : cleanName
  return join(downloads, `${base}-${Date.now()}${ext}`)
}
