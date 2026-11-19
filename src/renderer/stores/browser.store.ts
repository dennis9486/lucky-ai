import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  BrowserBookmark,
  BrowserDownload,
  BrowserHistoryClearRange,
  BrowserHistoryEntry
} from '../../shared/types/browser.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { useUiStore } from './ui.store.js'

export type BrowserPanel = 'bookmarks' | 'history' | 'downloads' | 'ai' | null

export const useBrowserStore = defineStore('browser', () => {
  const pendingUrl = ref<string | null>(null)
  /** target=_blank / window.open 转发来的 URL，由浏览器视图消费后在新标签打开 */
  const pendingNewTabUrl = ref<string | null>(null)
  const pendingAiPrompt = ref<{ prompt: string; autoSend: boolean } | null>(null)
  const activeTabUrl = ref<string | null>(null)
  const activeTabTitle = ref<string | null>(null)
  const bookmarks = ref<BrowserBookmark[]>([])
  const history = ref<BrowserHistoryEntry[]>([])
  const downloads = ref<BrowserDownload[]>([])
  const activePanel = ref<BrowserPanel>(null)
  const libraryQuery = ref('')
  const lastError = ref<string | null>(null)
  let unsubscribeDownloads: (() => void) | null = null
  let unsubscribeOpenUrl: (() => void) | null = null
  let unsubscribeOpenNewTab: (() => void) | null = null

  function openUrl(url: string): void {
    pendingUrl.value = url
    useUiStore().currentView = 'browser'
  }

  function openUrlInNewTab(url: string): void {
    pendingNewTabUrl.value = url
    useUiStore().currentView = 'browser'
  }

  function requestAiPrompt(prompt: string, autoSend = true): void {
    const trimmed = prompt.trim()
    if (!trimmed) return
    pendingAiPrompt.value = { prompt: trimmed, autoSend }
    useUiStore().currentView = 'browser'
    openPanel('ai')
  }

  function consumePendingUrl(): string | null {
    const url = pendingUrl.value
    pendingUrl.value = null
    return url
  }

  function consumePendingNewTabUrl(): string | null {
    const url = pendingNewTabUrl.value
    pendingNewTabUrl.value = null
    return url
  }

  function consumePendingAiPrompt(): { prompt: string; autoSend: boolean } | null {
    const pending = pendingAiPrompt.value
    pendingAiPrompt.value = null
    return pending
  }

  function setActiveTab(url: string | null, title: string | null): void {
    activeTabUrl.value = url
    activeTabTitle.value = title
  }

  async function loadBookmarks(): Promise<void> {
    bookmarks.value = await safeBrowserCall(ipc.browser.listBookmarks(), [])
  }

  async function loadHistory(): Promise<void> {
    history.value = await safeBrowserCall(ipc.browser.listHistory(), [])
  }

  async function loadDownloads(): Promise<void> {
    downloads.value = await safeBrowserCall(ipc.browser.listDownloads(), [])
  }

  async function bootstrap(): Promise<void> {
    await Promise.allSettled([loadBookmarks(), loadHistory(), loadDownloads()])
    unsubscribeDownloads?.()
    unsubscribeOpenUrl?.()
    unsubscribeOpenNewTab?.()
    unsubscribeDownloads = ipc.browser.onDownloadsChanged((items: BrowserDownload[]) => {
      downloads.value = items
    })
    unsubscribeOpenUrl = ipc.browser.onOpenUrl((url: string) => {
      openUrl(url)
    })
    unsubscribeOpenNewTab = ipc.browser.onOpenUrlInNewTab((url: string) => {
      openUrlInNewTab(url)
    })
  }

  async function toggleBookmark(url: string, title: string): Promise<boolean> {
    const existing = bookmarks.value.find((b) => b.url === url)
    if (existing) {
      await unwrap(ipc.browser.removeBookmark(existing.id))
      bookmarks.value = bookmarks.value.filter((b) => b.id !== existing.id)
      return false
    }
    const created = await unwrap<BrowserBookmark>(ipc.browser.addBookmark(url, title))
    bookmarks.value = [created, ...bookmarks.value]
    return true
  }

  async function recordVisit(url: string, title: string): Promise<void> {
    const entry = await unwrap<BrowserHistoryEntry>(ipc.browser.recordHistory(url, title))
    history.value = [entry, ...history.value.filter((h) => h.url !== url)].slice(0, 100)
  }

  async function clearHistory(): Promise<void> {
    await unwrap(ipc.browser.clearHistory())
    history.value = []
  }

  async function clearHistoryRange(range: BrowserHistoryClearRange): Promise<void> {
    await unwrap(ipc.browser.clearHistoryRange(range))
    await loadHistory()
  }

  async function removeHistory(id: string): Promise<void> {
    await unwrap(ipc.browser.removeHistory(id))
    history.value = history.value.filter((item) => item.id !== id)
  }

  async function clearDownloads(): Promise<void> {
    await unwrap(ipc.browser.clearDownloads())
    await loadDownloads()
  }

  async function removeDownload(id: string): Promise<void> {
    await unwrap(ipc.browser.removeDownload(id))
    downloads.value = downloads.value.filter((item) => item.id !== id)
  }

  async function clearBrowsingData(): Promise<void> {
    await unwrap(ipc.browser.clearBrowsingData())
    history.value = []
    downloads.value = []
  }

  function togglePanel(panel: BrowserPanel): void {
    activePanel.value = activePanel.value === panel ? null : panel
    if (activePanel.value) libraryQuery.value = ''
  }

  function openPanel(panel: Exclude<BrowserPanel, null>): void {
    activePanel.value = panel
    libraryQuery.value = ''
  }

  function closePanel(): void {
    activePanel.value = null
    libraryQuery.value = ''
  }

  async function openDownload(path: string): Promise<void> {
    if (path) await unwrap(ipc.app.openPath(path))
  }

  async function revealDownload(path: string): Promise<void> {
    if (path) await unwrap(ipc.app.showItemInFolder(path))
  }

  async function safeBrowserCall<T>(
    promise: Promise<{ success: boolean; data?: T; error?: string }>,
    fallback: T
  ): Promise<T> {
    try {
      const result = await promise
      if (!result.success) {
        lastError.value = result.error ?? 'Browser IPC failed'
        return fallback
      }
      lastError.value = null
      return result.data as T
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      return fallback
    }
  }

  return {
    pendingUrl,
    pendingNewTabUrl,
    pendingAiPrompt,
    activeTabUrl,
    activeTabTitle,
    bookmarks,
    history,
    downloads,
    activePanel,
    libraryQuery,
    lastError,
    openUrl,
    openUrlInNewTab,
    requestAiPrompt,
    consumePendingUrl,
    consumePendingNewTabUrl,
    consumePendingAiPrompt,
    setActiveTab,
    bootstrap,
    loadBookmarks,
    loadHistory,
    loadDownloads,
    toggleBookmark,
    recordVisit,
    clearHistory,
    clearHistoryRange,
    removeHistory,
    clearDownloads,
    removeDownload,
    clearBrowsingData,
    togglePanel,
    openPanel,
    closePanel,
    openDownload,
    revealDownload
  }
})
