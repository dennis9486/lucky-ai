<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Clock3,
  Download,
  Globe2,
  House,
  Menu,
  Pin,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  VenetianMask,
  Volume2,
  VolumeX,
  X
} from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { ipc } from '../../services/ipc-client.js'
import BrowserOmnibox from './BrowserOmnibox.vue'
import BrowserSettingsMenu from './BrowserSettingsMenu.vue'
import BrowserSidePanel from './BrowserSidePanel.vue'
import BrowserAiPanel from './BrowserAiPanel.vue'
import BrowserHistoryPage from './BrowserHistoryPage.vue'
import BrowserDownloadsPage from './BrowserDownloadsPage.vue'
import BrowserSettingsPage from './BrowserSettingsPage.vue'
import BrowserFindBar from './BrowserFindBar.vue'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'
import { normalizeBrowserHomepage } from '../../../shared/utils/browser-url.js'
import { createLogger } from '../../../shared/utils/log.js'
import {
  DESKTOP_UA,
  MOBILE_UA,
  ZOOM_STEPS,
  TAB_GROUP_COLORS,
  createBrowserTab,
  type BrowserTab,
  type TabGroup,
  type WebviewEvent
} from './browser-model.js'
import { useWebviewRegistry } from './useWebviewRegistry.js'

const { t } = useI18n()
const browser = useBrowserStore()
const settings = useSettingsStore()
const ui = useUiStore()
const logger = createLogger('renderer/browser-view', {
  debugEnabled: () => Boolean(import.meta.env.DEV)
})
const addressInput = ref('')
const omniboxRef = ref<{ focus: () => void } | null>(null)
const findBarRef = ref<{ focus: () => void } | null>(null)
const isBookmarked = ref(false)
const activeTabId = ref<string>('')
const tabs = ref<BrowserTab[]>([createTab()])
let isViewActive = false

const findOpen = ref(false)
const findQuery = ref('')
const findResult = ref<{ active: number; total: number }>({ active: 0, total: 0 })
const settingsOpen = ref(false)
const tabMenu = ref<{ x: number; y: number; items: ContextMenuItem[]; tabId: string } | null>(null)
const groupMenu = ref<{ x: number; y: number; items: ContextMenuItem[]; groupId: string } | null>(null)
const draggedTabId = ref<string | null>(null)
const groups = ref<TabGroup[]>([])
/** 最近关闭的标签（非隐身/非内置页），供 Cmd+Shift+T / 菜单恢复 */
const closedTabStack = ref<Array<{ url: string; title: string; pinned: boolean }>>([])
const MAX_CLOSED_TABS = 20
const SESSION_STORAGE_KEY = 'lucky:browser-session:v1'
const {
  setWebviewRef,
  webviewFor,
  activeWebview,
  queueLoad,
  takeQueuedLoad,
  forgetTab
} = useWebviewRegistry(activeTabId, logger)

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? tabs.value[0] ?? null)
const activePanel = computed(() => browser.activePanel)
const hasPage = computed(() => Boolean(activeTab.value?.url))
const isInternalTab = computed(() => Boolean(activeTab.value?.internalPage))
const canGoBack = computed(() => activeTab.value?.canGoBack ?? false)
const canGoForward = computed(() => activeTab.value?.canGoForward ?? false)
const isLoading = computed(() => activeTab.value?.isLoading ?? false)
const loadError = computed(() => activeTab.value?.loadError ?? '')
const pageTitle = computed(() => activeTab.value?.title || defaultTabTitle())
const homepageUrl = computed(() => browserHomepage())
const hasHomepage = computed(() => Boolean(homepageUrl.value))
const zoomPercent = computed(() => Math.round((activeTab.value?.zoom ?? 1) * 100))
const showZoom = computed(() => zoomPercent.value !== 100)
const isDesktopMode = computed(() => activeTab.value?.desktop ?? true)

const security = computed<'secure' | 'insecure' | 'none'>(() => {
  const url = activeTab.value?.url ?? ''
  if (isInternalTab.value) return 'none'
  if (/^https:\/\//i.test(url)) return 'secure'
  if (/^http:\/\//i.test(url)) return 'insecure'
  return 'none'
})

function createTab(url = browserHomepage(), options: { incognito?: boolean } = {}): BrowserTab {
  return createBrowserTab(defaultTabTitle(), url, options)
}

type BrowserInternalPage = NonNullable<BrowserTab['internalPage']>

function createInternalTab(page: BrowserInternalPage): BrowserTab {
  const title = page === 'history'
    ? t('browser.history')
    : page === 'downloads'
      ? t('browser.downloads')
      : t('browser.settings')
  const url = `lucky://${page}`
  return {
    ...createBrowserTab(title, ''),
    title,
    url,
    mountSrc: '',
    internalPage: page
  }
}

function browserHomepage(): string {
  return normalizeBrowserHomepage(settings.general.browserHomepage)
}

function defaultTabTitle(): string {
  return t('browser.untitledTab')
}

function findTab(id: string): BrowserTab | undefined {
  return tabs.value.find((tab) => tab.id === id)
}

function patchTab(id: string, patch: Partial<BrowserTab>): void {
  const tab = findTab(id)
  if (!tab) return
  Object.assign(tab, patch)
}

function syncActiveTabToStore(): void {
  const tab = activeTab.value
  browser.setActiveTab(tab?.url || null, tab?.title || null)
}

/** 把当前活动 webview 的 guest webContentsId 上报主进程，供 chat Agent 控制浏览器。 */
function reportActiveWebContents(): void {
  const view = activeWebview()
  if (!view) {
    void ipc.browser.setActiveWebContents(null)
    return
  }
  try {
    const id = view.getWebContentsId()
    if (typeof id === 'number') void ipc.browser.setActiveWebContents(id)
  } catch {
    // webview 尚未 attach，dom-ready 后会再上报
  }
  scheduleTabsSync()
}

/**
 * 全量同步标签映射到主进程（tabId → webContentsId），供 Agent 按 tab_id
 * 寻址非活动标签（多标签读取/对比/操作）。隐身与内置页标签不上报。
 */
let tabsSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTabsSync(): void {
  if (tabsSyncTimer) clearTimeout(tabsSyncTimer)
  tabsSyncTimer = setTimeout(syncTabsToMain, 300)
}

function syncTabsToMain(): void {
  const payload: Array<{ tabId: string; webContentsId: number; url: string; title: string; active: boolean }> = []
  for (const tab of tabs.value) {
    if (tab.incognito || tab.internalPage || !tab.mountSrc) continue
    const view = webviewFor(tab.id)
    if (!view) continue
    try {
      const webContentsId = view.getWebContentsId()
      if (typeof webContentsId !== 'number') continue
      payload.push({ tabId: tab.id, webContentsId, url: tab.url, title: tab.title, active: tab.id === activeTabId.value })
    } catch {
      // webview 尚未 attach：跳过，dom-ready 后的下一次同步会补上
    }
  }
  void ipc.browser.syncTabs(payload)
}

watch([tabs, activeTabId], scheduleTabsSync, { deep: true })

onMounted(async () => {
  hibernateTimer = setInterval(hibernateSweep, HIBERNATE_SWEEP_MS)
  const restored = restoreSession()
  if (!restored && tabs.value[0]) activeTabId.value = tabs.value[0].id
  await browser.bootstrap()
  if (!openPendingUrl() && !openPendingNewTab() && !restored) openHomepageIfBlank()
})

onActivated(() => {
  isViewActive = true
  window.addEventListener('keydown', onGlobalKeydown, true)
})

onDeactivated(() => {
  isViewActive = false
  settingsOpen.value = false
  window.removeEventListener('keydown', onGlobalKeydown, true)
})

onUnmounted(() => {
  if (hibernateTimer) clearInterval(hibernateTimer)
  hibernateTimer = null
})

/** 单一加载模型：绝不对未 dom-ready 的 webview 调 loadURL —— 那是崩溃根因。 */
function loadUrl(target: string, tabId = activeTabId.value): void {
  if (!target) return
  const internal = target.match(/^lucky:\/\/(history|downloads|settings)$/i)?.[1] as BrowserInternalPage | undefined
  if (internal) {
    openInternalTab(internal)
    return
  }
  const tab = findTab(tabId)
  if (!tab) return
  patchTab(tabId, {
    url: target,
    loadError: '',
    canGoBack: false,
    canGoForward: false,
    internalPage: null,
    hibernated: false,
    title: tab.title || defaultTabTitle()
  })
  if (tabId === activeTabId.value) {
    addressInput.value = target
    syncActiveTabToStore()
  }
  if (!tab.mountSrc) {
    patchTab(tabId, { mountSrc: target, domReady: false })
    return
  }
  const view = webviewFor(tabId)
  if (view && findTab(tabId)?.domReady) {
    patchTab(tabId, { domReady: false })
    logger.info('webview load url', { tabId, target })
    void view.loadURL(target).catch((error) => {
      logger.warn('webview load url failed', { tabId, target, error })
      patchTab(tabId, { loadError: t('browser.loadError') })
    })
  } else {
    logger.debug('queue webview load until dom-ready', { tabId, target })
    queueLoad(tabId, target)
  }
}

function openPendingUrl(): boolean {
  const url = browser.consumePendingUrl()
  if (!url) return false
  loadUrl(url)
  return true
}

function openPendingNewTab(): boolean {
  const url = browser.consumePendingNewTabUrl()
  if (!url) return false
  newTab(url)
  return true
}

function openHomepageIfBlank(): void {
  const tab = activeTab.value
  const homepage = browserHomepage()
  if (tab && !tab.url && homepage) loadUrl(homepage, tab.id)
}

watch(() => browser.pendingUrl, (url) => {
  if (url) openPendingUrl()
})

watch(() => browser.pendingNewTabUrl, (url) => {
  if (url) openPendingNewTab()
})

watch(
  () => activeTab.value?.url,
  (url) => {
    isBookmarked.value = url ? browser.bookmarks.some((item) => item.url === url) : false
  },
  { immediate: true }
)

watch(activeTabId, (tabId, previousTabId) => {
  const now = Date.now()
  if (previousTabId) tabLastActiveAt.set(previousTabId, now)
  tabLastActiveAt.set(tabId, now)
  const tab = findTab(tabId)
  if (!tab) return
  if (tab.hibernated) reviveTab(tab)
  addressInput.value = tab.url
  updateNavigationState(tabId)
  syncActiveTabToStore()
  reportActiveWebContents()
  closeFind()
})

function newTab(url = '', options: { incognito?: boolean } = {}): void {
  const tab = createTab(url, options)
  tabs.value.push(tab)
  activeTabId.value = tab.id
  addressInput.value = tab.url
  syncActiveTabToStore()
  if (!url) focusAddress()
}

function openInternalTab(page: BrowserInternalPage): void {
  const existing = tabs.value.find((tab) => tab.internalPage === page)
  if (existing) {
    activeTabId.value = existing.id
    return
  }
  const tab = createInternalTab(page)
  tabs.value.push(tab)
  activeTabId.value = tab.id
  addressInput.value = tab.url
  syncActiveTabToStore()
}

function closeTab(id: string, e?: Event): void {
  e?.stopPropagation()
  rememberClosedTab(id)
  forgetTab(id)
  if (tabs.value.length === 1) {
    const tab = createTab('')
    tabs.value = [tab]
    activeTabId.value = tab.id
    addressInput.value = ''
    syncActiveTabToStore()
    return
  }
  const index = tabs.value.findIndex((tab) => tab.id === id)
  tabs.value = tabs.value.filter((tab) => tab.id !== id)
  pruneEmptyGroups()
  if (activeTabId.value === id) {
    const next = tabs.value[Math.max(0, index - 1)] ?? tabs.value[0]
    // 避免落到折叠分组里的隐藏标签
    const target = next && isTabHidden(next) ? tabs.value.find((tab) => !isTabHidden(tab)) ?? next : next
    if (target) activeTabId.value = target.id
  }
}

function selectTab(id: string): void {
  if (!findTab(id)) return
  activeTabId.value = id
}

function rememberClosedTab(id: string): void {
  const tab = findTab(id)
  if (!tab || !tab.url || tab.incognito || tab.internalPage) return
  closedTabStack.value.push({ url: tab.url, title: tab.title, pinned: tab.pinned })
  if (closedTabStack.value.length > MAX_CLOSED_TABS) closedTabStack.value.shift()
}

/** 恢复最近关闭的标签（Cmd+Shift+T / 标签右键菜单） */
function reopenClosedTab(): void {
  const entry = closedTabStack.value.pop()
  if (!entry) return
  newTab(entry.url)
  if (entry.pinned) {
    patchTab(activeTabId.value, { pinned: true })
    resortPinnedTabs()
  }
}

/** 固定/取消固定：固定标签移出分组并稳定排到最前 */
function togglePinTab(id: string): void {
  const tab = findTab(id)
  if (!tab) return
  patchTab(id, { pinned: !tab.pinned, groupId: !tab.pinned ? null : tab.groupId })
  resortPinnedTabs()
  pruneEmptyGroups()
}

function resortPinnedTabs(): void {
  tabs.value = [...tabs.value.filter((tab) => tab.pinned), ...tabs.value.filter((tab) => !tab.pinned)]
}

// ---- 标签休眠 ----------------------------------------------------------------
/** 不活动超过该时长的后台标签卸载 webview（释放渲染进程内存） */
const HIBERNATE_AFTER_MS = 20 * 60_000
const HIBERNATE_SWEEP_MS = 60_000
/** tabId → 最近一次处于活动状态的时间 */
const tabLastActiveAt = new Map<string, number>()
let hibernateTimer: ReturnType<typeof setInterval> | null = null

function hibernateEligible(tab: BrowserTab, now: number): boolean {
  if (tab.id === activeTabId.value) return false
  if (!tab.mountSrc || tab.hibernated || tab.internalPage) return false
  if (tab.pinned || tab.audible) return false
  const lastActive = tabLastActiveAt.get(tab.id) ?? now
  return now - lastActive > HIBERNATE_AFTER_MS
}

/** 休眠：卸载 webview（销毁 guest 渲染进程），保留 url/title/favicon 供复活 */
function hibernateTab(tab: BrowserTab): void {
  logger.info('hibernate tab', { tabId: tab.id, url: tab.url })
  forgetTab(tab.id)
  patchTab(tab.id, {
    mountSrc: '',
    hibernated: true,
    domReady: false,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    loadError: ''
  })
}

/** 复活：mountSrc 回填 url，webview 重新挂载即按单一加载模型安全加载 */
function reviveTab(tab: BrowserTab): void {
  if (!tab.hibernated) return
  logger.info('revive tab', { tabId: tab.id, url: tab.url })
  patchTab(tab.id, { mountSrc: tab.url, hibernated: false, domReady: false })
}

function hibernateSweep(): void {
  const now = Date.now()
  for (const tab of tabs.value) {
    if (hibernateEligible(tab, now)) hibernateTab(tab)
  }
}

/** webview 渲染进程崩溃：提示并允许用户刷新恢复（webview 元素仍在，reload 即重启 guest） */
function handleRenderGone(tabId: string): void {
  logger.warn('webview render process gone', { tabId })
  patchTab(tabId, { isLoading: false, domReady: false, loadError: t('browser.renderGone') })
}

// ---- 会话跨重启恢复 -----------------------------------------------------------
interface PersistedBrowserSession {
  tabs: Array<{ url: string; title: string; pinned: boolean; groupId: string | null }>
  groups: TabGroup[]
  activeIndex: number
}

function persistSession(): void {
  const persistable = tabs.value.filter((tab) => tab.url && !tab.incognito && !tab.internalPage)
  const session: PersistedBrowserSession = {
    tabs: persistable.map((tab) => ({ url: tab.url, title: tab.title, pinned: tab.pinned, groupId: tab.groupId })),
    groups: groups.value,
    activeIndex: Math.max(0, persistable.findIndex((tab) => tab.id === activeTabId.value))
  }
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch { /* 存储满等异常不影响浏览 */ }
}

/** 启动时恢复上次会话（无持久化记录时保持默认单空白页） */
function restoreSession(): boolean {
  let session: PersistedBrowserSession | null = null
  try {
    session = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') as PersistedBrowserSession | null
  } catch {
    return false
  }
  if (!session?.tabs?.length) return false

  groups.value = Array.isArray(session.groups) ? session.groups : []
  const validGroupIds = new Set(groups.value.map((group) => group.id))
  const activeIndex = Math.min(Math.max(session.activeIndex, 0), session.tabs.length - 1)
  tabs.value = session.tabs.map((entry, index) => ({
    ...createTab(entry.url),
    // 仅活动标签立即装载；其余以休眠态恢复（点击时再加载），启动不再全量拉起 webview
    mountSrc: index === activeIndex ? entry.url : '',
    hibernated: index !== activeIndex,
    title: entry.title || defaultTabTitle(),
    pinned: Boolean(entry.pinned),
    groupId: entry.groupId && validGroupIds.has(entry.groupId) ? entry.groupId : null
  }))
  resortPinnedTabs()
  const active = tabs.value.find((tab) => tab.mountSrc) ?? tabs.value[0]
  if (active) activeTabId.value = active.id
  logger.info('browser session restored', { tabs: tabs.value.length, groups: groups.value.length })
  return true
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
watch([tabs, groups, activeTabId], () => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistSession, 800)
}, { deep: true })

function cycleTab(delta: number): void {
  if (tabs.value.length < 2) return
  const index = tabs.value.findIndex((tab) => tab.id === activeTabId.value)
  const next = tabs.value[(index + delta + tabs.value.length) % tabs.value.length]
  if (next) activeTabId.value = next.id
}

function goBack(): void {
  const view = activeWebview()
  if (!view || !activeTab.value?.domReady) return
  try {
    if (view.canGoBack()) view.goBack()
  } catch {
    patchTab(activeTabId.value, { canGoBack: false })
  }
}

function goForward(): void {
  const view = activeWebview()
  if (!view || !activeTab.value?.domReady) return
  try {
    if (view.canGoForward()) view.goForward()
  } catch {
    patchTab(activeTabId.value, { canGoForward: false })
  }
}

function reload(ignoreCache = false): void {
  const view = activeWebview()
  if (!view || !activeTab.value?.domReady) return
  if (ignoreCache) view.reloadIgnoringCache()
  else view.reload()
}

function refreshOrStop(): void {
  if (isInternalTab.value) return
  const view = activeWebview()
  if (!view) return
  if (isLoading.value) view.stop()
  else if (hasPage.value) reload()
}

function goHome(): void {
  const homepage = homepageUrl.value
  if (homepage) loadUrl(homepage)
}

function updateNavigationState(tabId: string): void {
  const view = webviewFor(tabId)
  const tab = findTab(tabId)
  if (!view || !tab?.domReady || tabId !== activeTabId.value) return
  try {
    patchTab(tabId, { canGoBack: view.canGoBack(), canGoForward: view.canGoForward() })
  } catch {
    patchTab(tabId, { canGoBack: false, canGoForward: false })
  }
}

function handleDomReady(tabId: string): void {
  patchTab(tabId, { domReady: true })
  logger.debug('webview dom-ready', { tabId })
  const view = webviewFor(tabId)
  const tab = findTab(tabId)
  if (view && tab) {
    try { view.setZoomFactor(tab.zoom) } catch { /* ignore */ }
    try { view.setUserAgent(tab.desktop ? DESKTOP_UA : MOBILE_UA) } catch { /* ignore */ }
  }
  const pending = takeQueuedLoad(tabId)
  if (pending && view) {
    patchTab(tabId, { domReady: false })
    logger.info('flush queued webview load', { tabId, pending })
    void view.loadURL(pending).catch((error) => {
      logger.warn('queued webview load failed', { tabId, pending, error })
      patchTab(tabId, { loadError: t('browser.loadError') })
    })
    return
  }
  if (tabId === activeTabId.value) {
    updateNavigationState(tabId)
    reportActiveWebContents()
  }
}

function handleStartLoading(tabId: string): void {
  patchTab(tabId, { isLoading: true, loadError: '' })
}

function handleStopLoading(tabId: string): void {
  patchTab(tabId, { isLoading: false })
  if (tabId === activeTabId.value) updateNavigationState(tabId)
}

function handleNavigate(tabId: string, event: WebviewEvent): void {
  const view = webviewFor(tabId)
  const nextUrl = event.url ?? view?.getURL() ?? ''
  if (!nextUrl || nextUrl.startsWith('about:')) return
  patchTab(tabId, { url: nextUrl })
  if (tabId === activeTabId.value) {
    addressInput.value = nextUrl
    isBookmarked.value = browser.bookmarks.some((item) => item.url === nextUrl)
    syncActiveTabToStore()
    updateNavigationState(tabId)
  }
}

function handleTitle(tabId: string, event: WebviewEvent): void {
  const view = webviewFor(tabId)
  const title = event.title || view?.getTitle() || t('browser.unnamedPage')
  patchTab(tabId, { title })
  const tab = findTab(tabId)
  // 无痕标签不写入历史
  if (tab?.url && !tab.incognito) void browser.recordVisit(tab.url, title)
  if (tabId === activeTabId.value) syncActiveTabToStore()
}

function handleFavicon(tabId: string, event: WebviewEvent): void {
  const favicon = event.favicons?.[0]
  if (favicon) patchTab(tabId, { favicon })
}

function onFaviconError(tabId: string): void {
  patchTab(tabId, { favicon: '' })
}

function handleFail(tabId: string, event: WebviewEvent): void {
  if (event.errorCode === -3) return
  logger.warn('webview load failed', {
    tabId,
    errorCode: event.errorCode,
    errorDescription: event.errorDescription
  })
  patchTab(tabId, {
    isLoading: false,
    domReady: true,
    loadError: event.errorDescription ?? t('browser.loadError')
  })
}

// ---- find in page ------------------------------------------------------------
function openFind(): void {
  findOpen.value = true
  void nextTick(() => {
    findBarRef.value?.focus()
    if (findQuery.value) runFind(true, false)
  })
}

function closeFind(): void {
  if (!findOpen.value) return
  findOpen.value = false
  findResult.value = { active: 0, total: 0 }
  try { activeWebview()?.stopFindInPage('clearSelection') } catch { /* ignore */ }
}

function runFind(forward: boolean, findNext: boolean): void {
  const view = activeWebview()
  const query = findQuery.value
  if (!view || !activeTab.value?.domReady) return
  if (!query) {
    findResult.value = { active: 0, total: 0 }
    try { view.stopFindInPage('clearSelection') } catch { /* ignore */ }
    return
  }
  try { view.findInPage(query, { forward, findNext }) } catch { /* ignore */ }
}

function handleFoundInPage(tabId: string, event: WebviewEvent): void {
  if (tabId !== activeTabId.value || !event.result) return
  findResult.value = { active: event.result.activeMatchOrdinal, total: event.result.matches }
}

// ---- zoom / ua / print / data ------------------------------------------------
function applyZoom(factor: number): void {
  const tab = activeTab.value
  const view = activeWebview()
  if (!tab) return
  const clamped = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1]!, Math.max(ZOOM_STEPS[0]!, factor))
  patchTab(tab.id, { zoom: clamped })
  if (view && tab.domReady) {
    try { view.setZoomFactor(clamped) } catch { /* ignore */ }
  }
}

function zoomBy(direction: 1 | -1): void {
  const current = activeTab.value?.zoom ?? 1
  const index = ZOOM_STEPS.reduce((best, step, i) =>
    Math.abs(step - current) < Math.abs(ZOOM_STEPS[best]! - current) ? i : best, 4)
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))]
  if (next != null) applyZoom(next)
}

function resetZoom(): void {
  applyZoom(1)
}

function toggleDesktopMode(): void {
  const tab = activeTab.value
  const view = activeWebview()
  if (!tab) return
  const desktop = !tab.desktop
  patchTab(tab.id, { desktop })
  if (view && tab.domReady) {
    try {
      view.setUserAgent(desktop ? DESKTOP_UA : MOBILE_UA)
      view.reload()
    } catch { /* ignore */ }
  }
}

function printPage(): void {
  try { activeWebview()?.print() } catch { /* ignore */ }
  settingsOpen.value = false
}

function openIncognitoTab(): void {
  settingsOpen.value = false
  newTab('', { incognito: true })
}

async function clearBrowsingData(): Promise<void> {
  settingsOpen.value = false
  const confirmed = await ui.confirm(t('browser.clearDataConfirm'), {
    title: t('browser.clearData'),
    danger: true,
    confirmLabel: t('browser.clearData')
  })
  if (!confirmed) return
  await browser.clearBrowsingData()
}

function focusAddress(): void {
  omniboxRef.value?.focus()
}

function openFromPanel(url: string): void {
  browser.closePanel()
  loadUrl(url)
}

// ---- keyboard shortcuts ------------------------------------------------------
function onGlobalKeydown(event: KeyboardEvent): void {
  if (!isViewActive) return
  if (event.key === 'Escape') {
    if (findOpen.value) { event.preventDefault(); closeFind(); return }
    if (settingsOpen.value) { event.preventDefault(); settingsOpen.value = false; return }
    if (browser.activePanel) { event.preventDefault(); browser.closePanel(); return }
  }
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault()
    cycleTab(event.shiftKey ? -1 : 1)
    return
  }
  const mod = event.metaKey || event.ctrlKey
  if (!mod) return
  switch (event.key.toLowerCase()) {
    case 't':
      event.preventDefault()
      if (event.shiftKey) reopenClosedTab()
      else newTab()
      break
    case 'w': event.preventDefault(); closeTab(activeTabId.value); break
    case 'l': event.preventDefault(); focusAddress(); break
    case 'r': event.preventDefault(); reload(event.shiftKey); break
    case 'f': event.preventDefault(); openFind(); break
    case '[': event.preventDefault(); goBack(); break
    case ']': event.preventDefault(); goForward(); break
    case '=':
    case '+': event.preventDefault(); zoomBy(1); break
    case '-': event.preventDefault(); zoomBy(-1); break
    case '0': event.preventDefault(); resetZoom(); break
  }
}

async function toggleBookmark(): Promise<void> {
  const tab = activeTab.value
  const url = tab?.url
  if (!url || tab?.internalPage) return
  isBookmarked.value = await browser.toggleBookmark(url, pageTitle.value)
}

// ---- 音频 / 静音 -------------------------------------------------------------
function handleMediaPlaying(tabId: string): void {
  patchTab(tabId, { audible: true })
}

function handleMediaPaused(tabId: string): void {
  patchTab(tabId, { audible: false })
}

function toggleMute(tabId: string, event: Event): void {
  event.stopPropagation()
  const tab = findTab(tabId)
  if (!tab) return
  const muted = !tab.muted
  patchTab(tabId, { muted })
  try { webviewFor(tabId)?.setAudioMuted(muted) } catch { /* ignore */ }
}

// ---- 标签拖拽重排 ------------------------------------------------------------
function onTabDragStart(id: string): void {
  draggedTabId.value = id
}

function onTabDragEnd(): void {
  draggedTabId.value = null
}

function onTabDrop(targetId: string): void {
  const from = draggedTabId.value
  draggedTabId.value = null
  if (!from || from === targetId) return
  const list = tabs.value
  const fromIdx = list.findIndex((tab) => tab.id === from)
  const target = list.find((tab) => tab.id === targetId)
  if (fromIdx < 0 || !target) return
  const [moved] = list.splice(fromIdx, 1)
  const toIdx = list.findIndex((tab) => tab.id === targetId)
  if (moved) {
    list.splice(toIdx, 0, moved)
    // 落在分组成员旁 → 加入该分组；落在未分组标签旁 → 退出分组（拖入/拖出）
    moved.groupId = target.groupId
  }
  pruneEmptyGroups()
}

/** 把标签拖到某个分组的头部胶囊上：加入该分组并挪到组内末尾。 */
function onTabDropOnGroup(groupId: string): void {
  const from = draggedTabId.value
  draggedTabId.value = null
  if (!from) return
  const list = tabs.value
  const fromIdx = list.findIndex((tab) => tab.id === from)
  if (fromIdx < 0) return
  const [moved] = list.splice(fromIdx, 1)
  if (!moved) return
  moved.groupId = groupId
  // 放到该组最后一个成员之后
  let insertAt = list.length
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.groupId === groupId) { insertAt = i + 1; break }
  }
  list.splice(insertAt, 0, moved)
  pruneEmptyGroups()
}

// ---- 标签分组 ----------------------------------------------------------------
function groupFor(groupId: string | null): TabGroup | undefined {
  return groupId ? groups.value.find((group) => group.id === groupId) : undefined
}

/** 该标签是否是其分组在 tabs 数组中的第一个成员（用于在它前面渲染分组头）。 */
function isFirstOfGroup(tab: BrowserTab): boolean {
  if (!tab.groupId) return false
  return tabs.value.find((item) => item.groupId === tab.groupId)?.id === tab.id
}

/** 折叠的分组隐藏其成员标签（分组头仍显示）。 */
function isTabHidden(tab: BrowserTab): boolean {
  return Boolean(tab.groupId && groupFor(tab.groupId)?.collapsed)
}

function groupMemberCount(groupId: string): number {
  return tabs.value.filter((tab) => tab.groupId === groupId).length
}

/** 删除已没有成员的分组。 */
function pruneEmptyGroups(): void {
  groups.value = groups.value.filter((group) => groupMemberCount(group.id) > 0)
}

function nextGroupColor(): string {
  const used = new Set(groups.value.map((group) => group.color))
  const free = TAB_GROUP_COLORS.find((color) => !used.has(color.value))
  return (free ?? TAB_GROUP_COLORS[0]!).value
}

function addTabToNewGroup(tabId: string): void {
  const tab = findTab(tabId)
  if (!tab) return
  const group: TabGroup = { id: crypto.randomUUID(), name: '', color: nextGroupColor(), collapsed: false }
  groups.value.push(group)
  tab.groupId = group.id
}

function addTabToGroup(tabId: string, groupId: string): void {
  const tab = findTab(tabId)
  if (tab) tab.groupId = groupId
}

function removeTabFromGroup(tabId: string): void {
  const tab = findTab(tabId)
  if (!tab) return
  tab.groupId = null
  pruneEmptyGroups()
}

function toggleGroupCollapsed(groupId: string): void {
  const group = groupFor(groupId)
  if (!group) return
  group.collapsed = !group.collapsed
  // 折叠含活动标签的分组时，把活动标签切到组外可见标签
  if (group.collapsed && activeTab.value?.groupId === groupId) {
    const visible = tabs.value.find((tab) => !isTabHidden(tab))
    if (visible) activeTabId.value = visible.id
  }
}

async function renameGroup(groupId: string): Promise<void> {
  const group = groupFor(groupId)
  if (!group) return
  const name = await ui.prompt(t('browser.groupNamePrompt'), { initialValue: group.name })
  if (name != null) group.name = name.trim()
}

function setGroupColor(groupId: string, color: string): void {
  const group = groupFor(groupId)
  if (group) group.color = color
}

function ungroup(groupId: string): void {
  for (const tab of tabs.value) {
    if (tab.groupId === groupId) tab.groupId = null
  }
  pruneEmptyGroups()
}

function closeGroup(groupId: string): void {
  const ids = tabs.value.filter((tab) => tab.groupId === groupId).map((tab) => tab.id)
  for (const id of ids) closeTab(id)
  pruneEmptyGroups()
}

function groupColorItems(): ContextMenuItem[] {
  return TAB_GROUP_COLORS.map((color) => ({
    id: `color:${color.id}:${color.value}`,
    label: t(`browser.groupColor.${color.id}`)
  }))
}

function openTabMenu(tabId: string, event: MouseEvent): void {
  const tab = findTab(tabId)
  if (!tab) return
  const items: ContextMenuItem[] = []
  items.push({ id: 'pin', label: tab.pinned ? t('browser.unpinTab') : t('browser.pinTab') })
  if (closedTabStack.value.length) {
    items.push({ id: 'reopen-closed', label: t('browser.reopenClosedTab') })
  }
  items.push({ id: 'sep-pin', separator: true })
  if (tab.groupId) {
    items.push({ id: 'group-remove', label: t('browser.removeFromGroup') })
  } else {
    items.push({ id: 'group-new', label: t('browser.addToNewGroup') })
    if (groups.value.length) {
      items.push({
        id: 'group-add',
        label: t('browser.addToGroup'),
        submenu: groups.value.map((group) => ({
          id: `addto:${group.id}`,
          label: group.name || t('browser.unnamedGroup')
        }))
      })
    }
  }
  items.push(
    { id: 'sep-close', separator: true },
    { id: 'close', label: t('browser.closeTab') },
    { id: 'close-others', label: t('browser.closeOtherTabs'), disabled: tabs.value.length < 2 },
    { id: 'close-right', label: t('browser.closeTabsToRight'), disabled: !hasTabsToRight(tabId) }
  )
  tabMenu.value = { x: event.clientX, y: event.clientY, items, tabId }
}

function hasTabsToRight(tabId: string): boolean {
  const idx = tabs.value.findIndex((tab) => tab.id === tabId)
  return idx >= 0 && idx < tabs.value.length - 1
}

function closeTabMenu(): void {
  tabMenu.value = null
}

function selectTabMenuItem(item: ContextMenuItem): void {
  const tabId = tabMenu.value?.tabId
  closeTabMenu()
  if (!tabId) return
  if (item.id === 'pin') { togglePinTab(tabId); return }
  if (item.id === 'reopen-closed') { reopenClosedTab(); return }
  if (item.id === 'group-new') { addTabToNewGroup(tabId); return }
  if (item.id === 'group-remove') { removeTabFromGroup(tabId); return }
  if (item.id.startsWith('addto:')) { addTabToGroup(tabId, item.id.slice('addto:'.length)); return }
  if (item.id === 'close') { closeTab(tabId); return }
  if (item.id === 'close-others') { closeOtherTabs(tabId); return }
  if (item.id === 'close-right') { closeTabsToRight(tabId); return }
}

function closeOtherTabs(keepId: string): void {
  for (const id of tabs.value.filter((tab) => tab.id !== keepId).map((tab) => tab.id)) closeTab(id)
}

function closeTabsToRight(fromId: string): void {
  const idx = tabs.value.findIndex((tab) => tab.id === fromId)
  if (idx < 0) return
  for (const id of tabs.value.slice(idx + 1).map((tab) => tab.id)) closeTab(id)
}

function openGroupMenu(groupId: string, event: MouseEvent): void {
  const group = groupFor(groupId)
  if (!group) return
  const items: ContextMenuItem[] = [
    { id: 'rename', label: t('browser.renameGroup') },
    { id: 'color', label: t('browser.groupColorLabel'), submenu: groupColorItems() },
    { id: 'collapse', label: group.collapsed ? t('browser.expandGroupTab') : t('browser.collapseGroupTab') },
    { id: 'sep-g', separator: true },
    { id: 'ungroup', label: t('browser.ungroup') },
    { id: 'close-group', label: t('browser.closeGroup'), danger: true }
  ]
  groupMenu.value = { x: event.clientX, y: event.clientY, items, groupId }
}

function closeGroupMenu(): void {
  groupMenu.value = null
}

function selectGroupMenuItem(item: ContextMenuItem): void {
  const groupId = groupMenu.value?.groupId
  closeGroupMenu()
  if (!groupId) return
  if (item.id === 'rename') { void renameGroup(groupId); return }
  if (item.id === 'collapse') { toggleGroupCollapsed(groupId); return }
  if (item.id === 'ungroup') { ungroup(groupId); return }
  if (item.id === 'close-group') { closeGroup(groupId); return }
  if (item.id.startsWith('color:')) { setGroupColor(groupId, item.id.split(':')[2] ?? ''); return }
}
</script>

<template>
  <section class="browser-view">
    <!-- Row 1: 纯浏览器 tab 栏（侧边栏钮 + 标签 + 新建） -->
    <header class="tab-bar">
      <div class="tabs-strip pretty-scrollbar browser-scroll">
        <template v-for="tab in tabs" :key="tab.id">
          <!-- 分组头胶囊：渲染在分组首个成员前 -->
          <button
            v-if="isFirstOfGroup(tab) && tab.groupId"
            type="button"
            class="group-pill"
            :style="{ '--group-color': groupFor(tab.groupId)?.color }"
            :title="groupFor(tab.groupId)?.name || t('browser.unnamedGroup')"
            @click="toggleGroupCollapsed(tab.groupId)"
            @contextmenu.prevent="openGroupMenu(tab.groupId, $event)"
            @dragover.prevent
            @drop.prevent="onTabDropOnGroup(tab.groupId)"
          >
            <span class="group-dot" />
            <span v-if="groupFor(tab.groupId)?.name" class="group-name">{{ groupFor(tab.groupId)?.name }}</span>
            <span v-if="groupFor(tab.groupId)?.collapsed" class="group-count">{{ groupMemberCount(tab.groupId) }}</span>
          </button>
          <button
            v-show="!isTabHidden(tab)"
            type="button"
            class="tab-chip"
            :class="{
              'is-active': tab.id === activeTabId,
              'is-incognito': tab.incognito,
              'is-dragging': tab.id === draggedTabId,
              'is-pinned': tab.pinned,
              'is-hibernated': tab.hibernated,
              'in-group': !!tab.groupId
            }"
            :style="tab.groupId ? { '--group-color': groupFor(tab.groupId)?.color } : undefined"
            draggable="true"
            @click="selectTab(tab.id)"
            @mousedown.middle.prevent="closeTab(tab.id)"
            @contextmenu.prevent="openTabMenu(tab.id, $event)"
            @dragstart="onTabDragStart(tab.id)"
            @dragover.prevent
            @drop.prevent="onTabDrop(tab.id)"
            @dragend="onTabDragEnd"
          >
            <span class="tab-favicon" aria-hidden="true">
              <VenetianMask v-if="tab.incognito" :size="14" :stroke-width="2.1" />
              <img v-else-if="tab.favicon" :src="tab.favicon" alt="" class="favicon-img" @error="onFaviconError(tab.id)" />
              <Globe2 v-else :size="15" :stroke-width="2.1" />
            </span>
            <span class="tab-title">{{ tab.title || t('browser.untitledTab') }}</span>
            <span
              v-if="tab.audible || tab.muted"
              class="tab-audio"
              :title="tab.muted ? t('browser.unmuteTab') : t('browser.muteTab')"
              :aria-label="tab.muted ? t('browser.unmuteTab') : t('browser.muteTab')"
              @click="toggleMute(tab.id, $event)"
            >
              <VolumeX v-if="tab.muted" :size="12" />
              <Volume2 v-else :size="12" />
            </span>
            <span
              v-if="tab.pinned"
              class="tab-close"
              :title="t('browser.unpinTab')"
              :aria-label="t('browser.unpinTab')"
              @click.stop="togglePinTab(tab.id)"
            >
              <Pin :size="11" />
            </span>
            <span v-else class="tab-close" :title="t('browser.closeTab')" :aria-label="t('browser.closeTab')" @click="closeTab(tab.id, $event)">
              <X :size="11" />
            </span>
          </button>
        </template>
      </div>
      <button type="button" class="toolbar-icon tab-add-btn" :title="t('browser.newTab')" :aria-label="t('browser.newTab')" @click="newTab()">
        <Plus :size="16" />
      </button>
    </header>

    <!-- Row 2: 导航工具栏 -->
    <div class="nav-row">
      <div class="nav-left">
        <button type="button" class="toolbar-icon" :disabled="!canGoBack" :title="t('browser.back')" :aria-label="t('browser.back')" @click="goBack">
          <ArrowLeft :size="16" />
        </button>
        <button type="button" class="toolbar-icon" :disabled="!canGoForward" :title="t('browser.forward')" :aria-label="t('browser.forward')" @click="goForward">
          <ArrowRight :size="16" />
        </button>
        <button type="button" class="toolbar-icon" :disabled="!hasPage" :title="isLoading ? t('browser.stop') : t('browser.reload')" @click="refreshOrStop">
          <RefreshCw :size="15" :class="{ 'is-spinning': isLoading }" />
        </button>
        <button type="button" class="toolbar-icon" :disabled="!hasHomepage" :title="t('browser.home')" :aria-label="t('browser.home')" @click="goHome">
          <House :size="16" />
        </button>
      </div>

      <BrowserOmnibox
        ref="omniboxRef"
        v-model="addressInput"
        :security="security"
        :zoom-percent="zoomPercent"
        :show-zoom="showZoom"
        @navigate="(url: string) => loadUrl(url)"
        @reset-zoom="resetZoom"
      />

      <div class="nav-right">
        <button
          type="button"
          class="toolbar-icon bookmark-btn"
          :class="{ 'is-bookmarked': isBookmarked }"
          :disabled="!hasPage || isInternalTab"
          :title="isBookmarked ? t('browser.removeBookmark') : t('browser.addBookmark')"
          @click="toggleBookmark"
        >
          <Star :size="14" :fill="isBookmarked ? 'currentColor' : 'none'" />
        </button>
        <button
          type="button"
          class="toolbar-icon ai-btn"
          :class="{ active: activePanel === 'ai' }"
          :title="t('browser.aiPanelTitle')"
          :aria-label="t('browser.aiPanelTitle')"
          @click="browser.togglePanel('ai')"
        >
          <Sparkles :size="14" />
        </button>
        <button type="button" class="toolbar-icon" :class="{ active: activePanel === 'bookmarks' }" :title="t('browser.bookmarks')" @click="browser.togglePanel('bookmarks')">
          <Bookmark :size="14" />
        </button>
        <button type="button" class="toolbar-icon" :class="{ active: activeTab?.internalPage === 'history' }" :title="t('browser.history')" @click="openInternalTab('history')">
          <Clock3 :size="14" />
        </button>
        <button type="button" class="toolbar-icon" :class="{ active: activeTab?.internalPage === 'downloads' }" :title="t('browser.downloads')" @click="openInternalTab('downloads')">
          <Download :size="14" />
        </button>
        <button
          type="button"
          class="toolbar-icon"
          :class="{ active: activeTab?.internalPage === 'settings' || settingsOpen }"
          :title="t('browser.settings')"
          :aria-label="t('browser.settings')"
          @click="openInternalTab('settings')"
        >
          <Menu :size="16" />
        </button>
      </div>

      <div v-if="isLoading" class="progress-bar" role="progressbar" :aria-label="t('browser.loading')">
        <div class="progress-indeterminate" />
      </div>
    </div>

    <BrowserSettingsMenu
      v-if="settingsOpen"
      :zoom-percent="zoomPercent"
      :is-desktop-mode="isDesktopMode"
      :has-page="hasPage"
      @close="settingsOpen = false"
      @zoom-in="zoomBy(1)"
      @zoom-out="zoomBy(-1)"
      @reset-zoom="resetZoom"
      @toggle-desktop="toggleDesktopMode"
      @print="printPage"
      @new-incognito="openIncognitoTab"
      @clear-data="clearBrowsingData"
    />

    <div class="browser-body">
      <main class="browser-content">
        <template v-for="tab in tabs" :key="tab.id">
          <BrowserHistoryPage
            v-if="tab.internalPage === 'history'"
            v-show="tab.id === activeTabId"
            @open="(url: string) => loadUrl(url, tab.id)"
            @open-new-tab="(url: string) => newTab(url)"
          />
          <BrowserDownloadsPage
            v-else-if="tab.internalPage === 'downloads'"
            v-show="tab.id === activeTabId"
          />
          <BrowserSettingsPage
            v-else-if="tab.internalPage === 'settings'"
            v-show="tab.id === activeTabId"
            @open-page="openInternalTab"
          />
          <webview
            v-else-if="tab.mountSrc"
            v-show="tab.id === activeTabId"
            :ref="(el: unknown) => setWebviewRef(tab.id, el)"
            class="browser-webview"
            :src="tab.mountSrc"
            :useragent="tab.desktop ? DESKTOP_UA : MOBILE_UA"
            :partition="tab.partition"
            allowpopups
            @dom-ready="handleDomReady(tab.id)"
            @did-start-loading="handleStartLoading(tab.id)"
            @did-stop-loading="handleStopLoading(tab.id)"
            @did-navigate="handleNavigate(tab.id, $event as WebviewEvent)"
            @did-navigate-in-page="handleNavigate(tab.id, $event as WebviewEvent)"
            @page-title-updated="handleTitle(tab.id, $event as WebviewEvent)"
            @page-favicon-updated="handleFavicon(tab.id, $event as WebviewEvent)"
            @did-fail-load="handleFail(tab.id, $event as WebviewEvent)"
            @found-in-page="handleFoundInPage(tab.id, $event as WebviewEvent)"
            @media-started-playing="handleMediaPlaying(tab.id)"
            @media-paused="handleMediaPaused(tab.id)"
            @render-process-gone="handleRenderGone(tab.id)"
            @crashed="handleRenderGone(tab.id)"
          />
        </template>

        <div v-if="!hasPage" class="empty-state">
          <Globe2 :size="72" :stroke-width="1.6" class="empty-icon" />
          <div class="empty-title">{{ t('browser.emptyTitle') }}</div>
          <div class="empty-desc">{{ t('browser.emptyDesc') }}</div>
        </div>

        <BrowserFindBar
          v-if="findOpen"
          ref="findBarRef"
          v-model="findQuery"
          :result="findResult"
          @search="runFind(true, false)"
          @next="runFind(true, true)"
          @prev="runFind(false, true)"
          @close="closeFind"
        />

        <div v-if="loadError" class="error-bar">{{ loadError }}</div>
      </main>
      <BrowserSidePanel @open="openFromPanel" />
      <BrowserAiPanel />
    </div>

    <ContextMenu
      v-if="tabMenu"
      :x="tabMenu.x"
      :y="tabMenu.y"
      :items="tabMenu.items"
      @close="closeTabMenu"
      @select="selectTabMenuItem"
    />
    <ContextMenu
      v-if="groupMenu"
      :x="groupMenu.x"
      :y="groupMenu.y"
      :items="groupMenu.items"
      @close="closeGroupMenu"
      @select="selectGroupMenuItem"
    />
  </section>
</template>

<style scoped>
.browser-view {
  @apply relative flex h-full min-h-0 flex-col text-codex-text;
  background: color-mix(in srgb, var(--codex-text) 3.5%, var(--codex-bg));
}
.tab-bar {
  @apply flex h-[42px] shrink-0 items-center gap-1 border-b px-2;
  border-color: color-mix(in srgb, var(--codex-text) 18%, var(--codex-border));
  background: color-mix(in srgb, var(--codex-text) 8.5%, var(--codex-bg));
}
.tabs-strip {
  @apply flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overflow-y-hidden pb-px;
}
.tab-add-btn {
  @apply shrink-0;
}
.tab-chip {
  @apply relative flex h-[34px] max-w-[210px] shrink-0 items-center gap-2 rounded-[11px] px-2 text-[13px] font-semibold
         transition-colors;
  color: color-mix(in srgb, var(--codex-text) 78%, var(--codex-muted));
}
.tab-chip.is-hibernated .tab-title,
.tab-chip.is-hibernated .tab-favicon {
  @apply opacity-50;
}
.tab-chip::after {
  @apply pointer-events-none absolute right-[-1px] top-2 h-[18px] w-px content-[''];
  background: color-mix(in srgb, var(--codex-text) 24%, transparent);
}
.tab-chip:hover {
  background: color-mix(in srgb, var(--codex-text) 11.5%, var(--codex-bg));
  color: var(--codex-text);
}
.tab-chip.is-active {
  @apply text-codex-text;
  background: color-mix(in srgb, var(--codex-bg) 74%, white);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--codex-text) 13%, transparent),
    0 1px 2px color-mix(in srgb, var(--codex-text) 8%, transparent);
}
.tab-chip.is-active::after,
.tab-chip:hover::after {
  opacity: 0;
}
.tab-chip.is-incognito {
  @apply text-codex-text;
}
.tab-chip.in-group {
  border-bottom: 2px solid var(--group-color, transparent);
  border-bottom-left-radius: 3px;
  border-bottom-right-radius: 3px;
}
.group-pill {
  @apply flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold;
  color: var(--group-color, var(--codex-muted));
  background: color-mix(in srgb, var(--group-color, var(--codex-text)) 12%, var(--codex-bg));
}
.group-pill:hover {
  background: color-mix(in srgb, var(--group-color, var(--codex-text)) 20%, var(--codex-bg));
}
.group-dot {
  @apply h-2.5 w-2.5 shrink-0 rounded-full;
  background: var(--group-color, var(--codex-muted));
}
.group-name {
  @apply max-w-[120px] truncate;
}
.group-count {
  @apply rounded px-1 text-[11px];
  background: color-mix(in srgb, var(--group-color, var(--codex-text)) 22%, var(--codex-bg));
}
.tab-favicon {
  @apply grid h-7 w-7 shrink-0 place-items-center rounded-md;
  color: color-mix(in srgb, var(--codex-text) 76%, var(--codex-muted));
}
.favicon-img {
  @apply h-[18px] w-[18px] rounded-[4px] object-contain;
}
.tab-chip.is-active .tab-favicon {
  @apply text-codex-accent;
}
.tab-chip.is-incognito .tab-favicon {
  color: color-mix(in srgb, var(--codex-text) 78%, var(--codex-muted));
}
.tab-title {
  @apply min-w-0 truncate leading-none;
}
.tab-chip.is-dragging {
  @apply opacity-50;
}
.tab-audio {
  @apply flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-codex-accent hover:bg-codex-border;
}
.tab-close {
  @apply ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text) 58%, var(--codex-muted));
}
.tab-close:hover {
  background: color-mix(in srgb, var(--codex-text) 13%, var(--codex-bg));
}
.nav-row {
  @apply relative flex h-[42px] shrink-0 items-center border-b px-1.5;
  border-color: color-mix(in srgb, var(--codex-text) 16%, var(--codex-border));
  background: color-mix(in srgb, var(--codex-text) 5.5%, var(--codex-bg));
}
.nav-left {
  @apply flex items-center gap-0.5;
}
.nav-right {
  @apply flex items-center gap-0.5;
}
.toolbar-icon {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
         transition-colors hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-55;
  color: color-mix(in srgb, var(--codex-text) 58%, var(--codex-muted));
}
.toolbar-icon:hover {
  background: color-mix(in srgb, var(--codex-text) 10%, var(--codex-bg));
}
.toolbar-icon.active,
.bookmark-btn.is-bookmarked {
  @apply text-codex-accent;
}
.progress-bar {
  @apply absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-transparent;
}
.progress-indeterminate {
  @apply h-full w-1/3 rounded-full;
  background: var(--codex-accent);
  animation: browser-progress 1.1s ease-in-out infinite;
}
@keyframes browser-progress {
  0% { transform: translateX(-120%); }
  60% { transform: translateX(280%); }
  100% { transform: translateX(280%); }
}
.browser-body {
  @apply flex min-h-0 flex-1 overflow-hidden;
}
.browser-content {
  @apply relative flex min-h-0 flex-1 overflow-hidden;
  background: color-mix(in srgb, var(--codex-text) 1.5%, var(--codex-bg));
}
.browser-webview {
  @apply absolute inset-0 h-full w-full;
}
.empty-state {
  @apply flex h-full w-full flex-col items-center justify-center text-center;
}
.empty-icon {
  @apply mb-6;
  color: color-mix(in srgb, var(--codex-text) 36%, var(--codex-muted));
}
.empty-title {
  @apply text-[18px] font-semibold text-codex-text;
}
.empty-desc {
  @apply mt-2 text-[14px];
  color: color-mix(in srgb, var(--codex-text) 42%, var(--codex-muted));
}
.error-bar {
  @apply absolute bottom-4 left-1/2 max-w-[720px] -translate-x-1/2 rounded-xl border border-red-200 bg-red-50
         px-4 py-2 text-[13px] font-medium text-red-700 shadow-sm;
}
:global([data-theme='dark']) .error-bar {
  @apply border-red-900/50 bg-red-950/40 text-red-300;
}
.is-spinning {
  animation: browser-spin 0.8s linear infinite;
}
@keyframes browser-spin {
  to { transform: rotate(360deg); }
}
</style>
