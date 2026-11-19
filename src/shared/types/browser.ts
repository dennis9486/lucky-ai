export type BrowserSearchEngine = 'duckduckgo' | 'bing' | 'google' | 'baidu'

/** 各搜索引擎的查询前缀（地址栏输入非 URL 时拼接）。 */
export const BROWSER_SEARCH_URLS: Record<BrowserSearchEngine, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd='
}

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  createdAt: number
}

export interface BrowserHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
}

export type BrowserHistoryClearRange = 'lastHour' | 'lastDay' | 'lastWeek' | 'lastFourWeeks' | 'all'

export type BrowserDownloadStatus = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface BrowserDownload {
  id: string
  url: string
  filename: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  status: BrowserDownloadStatus
  startedAt: number
  completedAt?: number
}

/** 页面变化监控 */
export interface BrowserPageMonitor {
  id: string
  url: string
  title: string
  intervalMinutes: number
  /** 最近一次抓取的正文首部（变化后即"变成了什么"的摘要） */
  lastExcerpt: string
  lastCheckedAt: number | null
  lastChangedAt: number | null
  lastError: string
  status: 'active' | 'paused'
  /** 变化时自动让 AI 分析（打开 AI 面板并发送分析 prompt） */
  aiAnalyze: boolean
  createdAt: number
}

