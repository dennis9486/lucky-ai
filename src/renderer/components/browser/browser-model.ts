export type WebviewEl = HTMLElement & {
  src: string
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  reloadIgnoringCache: () => void
  stop: () => void
  loadURL: (url: string) => Promise<void>
  setZoomFactor: (factor: number) => void
  setUserAgent: (userAgent: string) => void
  setAudioMuted: (muted: boolean) => void
  copy: () => void
  print: () => void
  openDevTools: () => void
  getWebContentsId: () => number
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
}

export interface WebviewContextMenuParams {
  x: number
  y: number
  linkURL?: string
  srcURL?: string
  selectionText?: string
}

export type WebviewEvent = Event & {
  url?: string
  title?: string
  favicons?: string[]
  errorDescription?: string
  errorCode?: number
  result?: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean }
}

export interface BrowserTab {
  id: string
  title: string
  url: string
  favicon: string
  mountSrc: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  domReady: boolean
  loadError: string
  zoom: number
  desktop: boolean
  incognito: boolean
  partition: string
  audible: boolean
  muted: boolean
  /** 固定标签：排序置前，关闭按钮变为取消固定 */
  pinned: boolean
  /** 已休眠：webview 已卸载（保留 url/title/favicon），激活时重建 */
  hibernated: boolean
  /** 所属标签分组 id；null 表示未分组 */
  groupId: string | null
  /** Lucky 内置浏览器页面；有值时不挂载 webview。 */
  internalPage: 'history' | 'downloads' | 'settings' | null
}

/** 标签分组（会话内内存态；跨重启需先持久化整个标签会话，另议）。 */
export interface TabGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
}

/** 分组配色（值即 CSS 颜色，直接用于左边线/底色）。 */
export const TAB_GROUP_COLORS: Array<{ id: string; value: string }> = [
  { id: 'grey', value: '#8a8f98' },
  { id: 'blue', value: '#4b8bf5' },
  { id: 'red', value: '#e5484d' },
  { id: 'yellow', value: '#d99e00' },
  { id: 'green', value: '#2fb344' },
  { id: 'purple', value: '#8b5cf6' },
  { id: 'pink', value: '#e955a0' }
]

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
export const PERSIST_PARTITION = 'persist:lucky-ai-browser'
export const INCOGNITO_PARTITION = 'lucky-ai-incognito'
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export function createBrowserTab(
  title: string,
  url = '',
  options: { incognito?: boolean } = {}
): BrowserTab {
  return {
    id: crypto.randomUUID(),
    title,
    url,
    favicon: '',
    mountSrc: url,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    domReady: false,
    loadError: '',
    zoom: 1,
    desktop: true,
    incognito: Boolean(options.incognito),
    partition: options.incognito ? INCOGNITO_PARTITION : PERSIST_PARTITION,
    audible: false,
    muted: false,
    pinned: false,
    hibernated: false,
    groupId: null,
    internalPage: null
  }
}
