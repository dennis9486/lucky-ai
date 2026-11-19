/**
 * page-monitor.service.ts — 页面变化监控
 *
 * 用户对某个 URL 建立监控后，按间隔抓取页面正文（webResearchService，
 * Crawlee+Playwright，能看到客户端渲染内容），对比正文哈希：
 * - 变化 → 原生通知（点击聚焦窗口）+ runtime 事件（Brain 总控台可见）+
 *   更新摘要（前后各存 400 字符首部，供 UI 展示"变成了什么"）。
 * - 抓取失败 → 记录 last_error，不中断监控（下个周期重试）。
 *
 * 轮询由自身 60s tick 驱动（与任务调度器解耦：监控是浏览器域的能力）。
 * 正文哈希前会把连续空白规整，降低无意义的 DOM 噪声误报。
 */

import { createHash, randomUUID } from 'node:crypto'
import { Notification, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import { DatabaseService } from '../db/database.service.js'
import { webResearchService } from './web-research.service.js'
import { agentRuntimeService } from './agent-runtime.service.js'
import { createLogger } from '../../shared/utils/log.js'
import type { BrowserPageMonitor } from '../../shared/types/browser.js'

const TICK_INTERVAL_MS = 60_000
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 24 * 60
const EXCERPT_CHARS = 400
/** 单轮 tick 最多检查的监控数（避免大量到期时集中抓取） */
const MAX_CHECKS_PER_TICK = 3

const logger = createLogger('main/page-monitor')

interface MonitorRow {
  id: string
  url: string
  title: string
  interval_minutes: number
  last_hash: string
  last_excerpt: string
  last_checked_at: number | null
  last_changed_at: number | null
  last_error: string
  status: 'active' | 'paused'
  ai_analyze: number
  created_at: number
  updated_at: number
}

function rowToMonitor(row: MonitorRow): BrowserPageMonitor {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    intervalMinutes: row.interval_minutes,
    lastExcerpt: row.last_excerpt,
    lastCheckedAt: row.last_checked_at,
    lastChangedAt: row.last_changed_at,
    lastError: row.last_error,
    status: row.status,
    aiAnalyze: row.ai_analyze === 1,
    createdAt: row.created_at
  }
}

function contentHash(text: string): string {
  return createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex')
}

export class PageMonitorService {
  private timer: ReturnType<typeof setInterval> | null = null
  private getWindow: (() => BrowserWindow | null) | null = null
  private checking = false

  constructor(private readonly resolveDb: () => Database.Database = () => DatabaseService.getInstance().db) {}

  private get db(): Database.Database {
    return this.resolveDb()
  }

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => logger.error('monitor tick failed', { error }))
    }, TICK_INTERVAL_MS)
    logger.info('page monitor started', { tickMs: TICK_INTERVAL_MS })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  list(): BrowserPageMonitor[] {
    const rows = this.db
      .prepare('SELECT * FROM browser_page_monitors ORDER BY created_at DESC')
      .all() as MonitorRow[]
    return rows.map(rowToMonitor)
  }

  create(url: string, title = '', intervalMinutes = 30, aiAnalyze = false): BrowserPageMonitor {
    const cleanUrl = url.trim()
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('仅支持监控 http/https 页面')
    const interval = Math.min(Math.max(Math.round(intervalMinutes), MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES)
    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO browser_page_monitors (id, url, title, interval_minutes, ai_analyze, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, cleanUrl, title.trim().slice(0, 200), interval, aiAnalyze ? 1 : 0, now, now)
    logger.info('monitor created', { id, url: cleanUrl, interval, aiAnalyze })
    // 立即做首次基线抓取（异步，不阻塞创建）
    void this.checkOne(id).catch(() => undefined)
    return rowToMonitor(this.db.prepare('SELECT * FROM browser_page_monitors WHERE id = ?').get(id) as MonitorRow)
  }

  setStatus(id: string, status: 'active' | 'paused'): void {
    this.db
      .prepare('UPDATE browser_page_monitors SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM browser_page_monitors WHERE id = ?').run(id)
  }

  /** 到期监控扫描（每轮最多 MAX_CHECKS_PER_TICK 个，其余下轮继续） */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM browser_page_monitors
           WHERE status = 'active'
             AND (last_checked_at IS NULL OR last_checked_at <= ? - interval_minutes * 60000)
           ORDER BY last_checked_at ASC
           LIMIT ?`
        )
        .all(now, MAX_CHECKS_PER_TICK) as MonitorRow[]
      for (const row of rows) {
        await this.checkOne(row.id)
      }
    } finally {
      this.checking = false
    }
  }

  /** 抓取一次并对比；返回是否发生变化 */
  async checkOne(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT * FROM browser_page_monitors WHERE id = ?').get(id) as MonitorRow | undefined
    if (!row) return false
    const now = Date.now()

    let text = ''
    try {
      const page = await webResearchService.fetch({ url: row.url, maxChars: 20_000 })
      text = String((page as { text?: string }).text ?? '')
    } catch (error) {
      this.db
        .prepare('UPDATE browser_page_monitors SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
        .run(now, String(error).slice(0, 300), now, id)
      logger.warn('monitor fetch failed', { id, url: row.url, error: String(error) })
      return false
    }

    const hash = contentHash(text)
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS)
    const isBaseline = !row.last_hash
    const changed = !isBaseline && hash !== row.last_hash

    this.db
      .prepare(
        `UPDATE browser_page_monitors
         SET last_checked_at = ?, last_error = '', last_hash = ?, last_excerpt = ?,
             last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END, updated_at = ?
         WHERE id = ?`
      )
      .run(now, hash, excerpt, changed ? 1 : 0, now, now, id)

    if (changed) this.notifyChange({ ...row, last_excerpt: excerpt })
    return changed
  }

  /**
   * AI 分析闭环：页面变化时把分析 prompt 发给渲染进程（CHAT_SEND_PROMPT），
   * 渲染进程会切到浏览器、打开 AI 面板并自动发送。窗口不在时跳过——
   * 原生通知仍会送达，用户点开后可自行追问。
   */
  private requestAiAnalysis(row: MonitorRow, label: string): void {
    const win = this.getWindow?.()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    const prompt = [
      `我监控的页面「${label}」检测到内容变化。`,
      `URL: ${row.url}`,
      `变化后的内容摘要（首部）: ${row.last_excerpt.slice(0, 300) || '(空)'}`,
      '',
      '请用 OpenInAppBrowser 打开该页面并阅读（ReadBrowserPage），说明相比之前发生了什么实质变化、是否需要我关注或采取行动。'
    ].join('\n')
    win.webContents.send(IPC_CHANNELS.CHAT_SEND_PROMPT, prompt)
  }

  private notifyChange(row: MonitorRow): void {
    const label = row.title || row.url
    logger.info('page changed', { id: row.id, url: row.url, aiAnalyze: row.ai_analyze === 1 })
    if (row.ai_analyze === 1) this.requestAiAnalysis(row, label)
    agentRuntimeService.recordExternalEvent({
      source: 'browser',
      title: `页面变化: ${label}`,
      detail: row.last_excerpt.slice(0, 300) || row.url,
      priority: 70,
      metadata: { monitorId: row.id, url: row.url }
    })
    // node 测试环境下 electron Notification 为 undefined，静默跳过
    if (!Notification?.isSupported?.()) return
    const notification = new Notification({
      title: `页面有更新：${label}`,
      body: row.last_excerpt.slice(0, 120) || row.url
    })
    notification.on('click', () => {
      const win = this.getWindow?.()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    notification.show()
  }
}

export const pageMonitorService = new PageMonitorService()
