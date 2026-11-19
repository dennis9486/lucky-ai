import { webContents, type WebContents } from 'electron'
import { browserNavigationService } from './browser-navigation.service.js'
import { createLogger } from '../../shared/utils/log.js'

const logger = createLogger('main/browser-control')
const DEFAULT_TIMEOUT = 15000
const USER_VISIBLE_ACTION_DELAY_MS = 180

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ElementActionability {
  ok: boolean
  x?: number
  y?: number
  tag?: string
  type?: string
  readOnly?: boolean
  sensitive?: boolean
  error?: string
}

export interface BrowserPageState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

/** renderer 上报的标签条目（隐身标签不上报——尊重隐私意图，Agent 不可见） */
export interface BrowserTabInfo {
  tabId: string
  webContentsId: number
  url: string
  title: string
  active: boolean
}

/**
 * 让 chat Agent 控制内置浏览器（WebBrowserView 的 <webview>）。
 *
 * webview 在渲染进程，但其 guest webContents 是真实 WebContents，主进程可直接操控。
 * 渲染进程只负责把「当前活动标签的 webContentsId」上报过来（tab 切换 / dom-ready 时），
 * 主进程据此拿到 WebContents 后即可导航 / 读取 / 前进后退——无需再往返渲染层。
 */
class BrowserControlService {
  private activeWebContentsId: number | null = null
  /** tabId → 标签信息（renderer 全量同步，支持 Agent 按 tab_id 寻址非活动标签） */
  private readonly tabRegistry = new Map<string, BrowserTabInfo>()

  setActiveWebContents(id: number | null): void {
    this.activeWebContentsId = typeof id === 'number' ? id : null
  }

  /** renderer 全量同步标签映射（切换/导航/关闭时调用） */
  syncTabs(tabs: BrowserTabInfo[]): void {
    this.tabRegistry.clear()
    for (const tab of tabs) {
      if (tab?.tabId && typeof tab.webContentsId === 'number') this.tabRegistry.set(tab.tabId, tab)
    }
    const active = tabs.find((tab) => tab.active)
    if (active) this.activeWebContentsId = active.webContentsId
  }

  /** Agent 可见的标签清单（过滤已销毁的 webContents） */
  listTabs(): Array<{ tabId: string; url: string; title: string; active: boolean }> {
    const result: Array<{ tabId: string; url: string; title: string; active: boolean }> = []
    for (const tab of this.tabRegistry.values()) {
      const wc = webContents.fromId(tab.webContentsId)
      if (!wc || wc.isDestroyed()) continue
      result.push({ tabId: tab.tabId, url: wc.getURL() || tab.url, title: wc.getTitle() || tab.title, active: tab.active })
    }
    return result
  }

  /**
   * 解析操作目标：给定 tabId 则按注册表寻址（可操作非活动标签），
   * 未给定则回落当前活动标签。
   */
  private resolveWebContents(tabId?: string): WebContents | null {
    if (tabId) {
      const entry = this.tabRegistry.get(tabId)
      if (!entry) return null
      const wc = webContents.fromId(entry.webContentsId)
      return wc && !wc.isDestroyed() ? wc : null
    }
    return this.getActiveWebContents()
  }

  /** 目标标签当前页面的 origin（无页面/非法 URL 返回空串），供站点级授权判定 */
  getOriginForTab(tabId?: string): string {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return ''
    try {
      return new URL(wc.getURL()).origin
    } catch {
      return ''
    }
  }

  private getActiveWebContents(): WebContents | null {
    if (this.activeWebContentsId == null) return null
    const wc = webContents.fromId(this.activeWebContentsId)
    return wc && !wc.isDestroyed() ? wc : null
  }

  private canGoBack(wc: WebContents): boolean {
    return wc.navigationHistory.canGoBack()
  }

  private canGoForward(wc: WebContents): boolean {
    return wc.navigationHistory.canGoForward()
  }

  private async resolveActionableElement(
    wc: WebContents,
    elementId: number,
    action: 'click' | 'fill'
  ): Promise<ElementActionability> {
    const script = `(() => new Promise((resolve) => {
      const done = (payload) => resolve(payload)
      const el = document.querySelector('[data-lucky-ai-id="${Math.floor(elementId)}"]')
      if (!el) return done({ ok: false, error: 'stale' })
      if (!el.isConnected) return done({ ok: false, error: 'detached' })
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return done({ ok: false, error: 'not-visible' })
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
          return done({ ok: false, error: 'not-visible' })
        }
        if (style.pointerEvents === 'none') return done({ ok: false, error: 'no-pointer-events' })
        const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true'
        if (disabled) return done({ ok: false, error: 'disabled' })
        const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1)
        const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
        const top = document.elementFromPoint(x, y)
        if (top && top !== el && !el.contains(top) && !top.contains(el)) {
          const label = (top.getAttribute('aria-label') || top.getAttribute('title') || top.tagName || '').toString().slice(0, 80)
          return done({ ok: false, error: 'covered', blocker: label })
        }
        const tag = el.tagName.toLowerCase()
        const type = String(el.getAttribute('type') || '').toLowerCase()
        const autocomplete = String(el.getAttribute('autocomplete') || '').toLowerCase()
        const readOnly = Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true'
        const sensitive = (tag === 'input' && type === 'password')
          || /(^|\\s)(current-password|new-password|cc-number|cc-csc|one-time-code)(\\s|$)/.test(autocomplete)
          || /captcha|验证码|otp|one.?time/i.test(String(el.getAttribute('name') || '') + ' ' + String(el.getAttribute('id') || '') + ' ' + String(el.getAttribute('placeholder') || ''))
        if (${JSON.stringify(action)} === 'fill') {
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return done({ ok: false, error: 'not-input' })
          if (readOnly) return done({ ok: false, error: 'readonly' })
          if (sensitive) return done({ ok: false, error: 'sensitive-field' })
        }
        done({ ok: true, x, y, tag, type, readOnly, sensitive })
      }))
    }))()`
    return await wc.executeJavaScript(script, true).catch((e) => ({
      ok: false,
      error: `error:${String(e)}`
    })) as ElementActionability
  }

  private describeActionabilityError(result: ElementActionability, fallback: string): string {
    switch (result.error) {
      case 'stale':
      case 'detached':
        return '元素序号已失效（页面已变化），请重新 SnapshotBrowserPage 后再操作'
      case 'not-visible':
        return '目标元素当前不可见，请先滚动或重新 SnapshotBrowserPage'
      case 'covered':
        return '目标元素被其他内容遮挡，请先关闭遮挡层或重新 SnapshotBrowserPage'
      case 'disabled':
        return '目标元素当前不可用'
      case 'readonly':
        return '目标输入框是只读的'
      case 'sensitive-field':
        return '目标是密码、验证码、银行卡或一次性代码等敏感字段，需要用户手动填写'
      case 'no-pointer-events':
        return '目标元素不可接收鼠标事件'
      case 'not-input':
        return '目标元素不是输入框/下拉框'
      default:
        return result.error ? `${fallback}: ${result.error}` : fallback
    }
  }

  getState(): BrowserPageState | null {
    const wc = this.getActiveWebContents()
    if (!wc) return null
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: this.canGoBack(wc),
      canGoForward: this.canGoForward(wc),
      loading: wc.isLoadingMainFrame()
    }
  }

  /** 轮询直到目标页加载完成（或超时）。resolve 缺省为当前活动标签。 */
  private async waitUntilReady(
    timeoutMs = DEFAULT_TIMEOUT,
    resolve: () => WebContents | null = () => this.getActiveWebContents()
  ): Promise<WebContents | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const wc = resolve()
      if (wc) {
        const url = wc.getURL()
        if (!wc.isLoadingMainFrame() && url && !url.startsWith('about:')) return wc
      }
      await delay(150)
    }
    return resolve()
  }

  async open(rawUrl: string): Promise<{ url: string; title: string; loaded: boolean }> {
    const normalized = browserNavigationService.openUrl(rawUrl)
    // 让渲染进程有机会挂载/切换标签并上报新的 webContentsId
    await delay(200)
    const wc = await this.waitUntilReady()
    if (!wc) {
      logger.warn('open: no active browser webContents after wait', { url: normalized })
      return { url: normalized, title: '', loaded: false }
    }
    return { url: wc.getURL(), title: wc.getTitle(), loaded: true }
  }

  /**
   * 读取页面正文。offset 支持长页分段读取：返回 totalChars/hasMore，
   * Agent 据此循环推进而不是一次塞爆上下文。
   */
  async readPage(maxChars = 8000, offset = 0, tabId?: string, mode: 'article' | 'full' = 'article'): Promise<{
    url: string
    title: string
    text: string
    totalChars: number
    offset: number
    hasMore: boolean
    extractionMode: 'article' | 'full'
  } | null> {
    let wc = this.resolveWebContents(tabId)
    if (!wc) return null
    if (wc.isLoadingMainFrame()) wc = (await this.waitUntilReady(DEFAULT_TIMEOUT, () => this.resolveWebContents(tabId))) ?? wc

    // article 模式：启发式正文提取（article/main/最大文本块），显著降低导航、
    // 侧栏、页脚等噪声占用的 token；提取量不足时自动回退全文。
    const extractScript = `(() => {
      const body = document.body
      if (!body) return { text: '', mode: 'full' }
      const fullText = body.innerText || ''
      if (${JSON.stringify(mode)} === 'full') return { text: fullText, mode: 'full' }
      const candidates = [
        ...document.querySelectorAll('article, main, [role="main"], [itemprop="articleBody"]')
      ]
      let best = null
      let bestLength = 0
      for (const el of candidates) {
        const length = (el.innerText || '').length
        if (length > bestLength) { best = el; bestLength = length }
      }
      // 阈值：正文块要有实质内容且占比合理，否则视为提取失败回退全文
      if (best && bestLength >= 500 && bestLength >= fullText.length * 0.3) {
        return { text: best.innerText, mode: 'article' }
      }
      return { text: fullText, mode: 'full' }
    })()`
    const extraction = await wc.executeJavaScript(extractScript, true)
      .catch(() => ({ text: '', mode: 'full' })) as { text: string; mode: 'article' | 'full' }
    const raw = extraction.text
    const clean = String(raw).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    const limit = Math.min(Math.max(maxChars, 500), 40000)
    const start = Math.min(Math.max(Math.floor(offset), 0), clean.length)
    const slice = clean.slice(start, start + limit)
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      text: slice,
      totalChars: clean.length,
      offset: start,
      hasMore: start + limit < clean.length,
      extractionMode: extraction.mode
    }
  }

  /**
   * 在页面中查找文本并滚动定位（高亮选中）。
   * 供"回答带引用"场景：Agent 引用了页面某段话后，可把用户视线带到出处。
   */
  async scrollToText(text: string, tabId?: string): Promise<{ found: boolean; url: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { found: false, url: '' }
    const query = text.trim().slice(0, 200)
    if (!query) return { found: false, url: wc.getURL() }
    const found = await wc.executeJavaScript(
      `(() => {
        const sel = window.getSelection()
        if (sel) sel.removeAllRanges()
        return window.find(${JSON.stringify(query)}, false, false, true, false, true, false)
      })()`,
      true
    ).catch(() => false) as boolean
    return { found: Boolean(found), url: wc.getURL() }
  }

  /**
   * 交互元素快照：给可见的链接/按钮/输入框打上稳定序号（data-lucky-ai-id），
   * 返回元素清单供 Agent 规划下一步。点击/填表前必须先快照——序号在每次
   * 快照时重排，跨快照的旧序号无效（防止页面变化后误点）。
   */
  async snapshotInteractive(maxElements = 60, tabId?: string): Promise<{
    url: string
    title: string
    elements: Array<Record<string, unknown>>
  } | null> {
    let wc = this.resolveWebContents(tabId)
    if (!wc) return null
    if (wc.isLoadingMainFrame()) wc = (await this.waitUntilReady(DEFAULT_TIMEOUT, () => this.resolveWebContents(tabId))) ?? wc
    const limit = Math.min(Math.max(maxElements, 10), 150)

    const script = `(() => {
      const selector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]'
      const visible = (el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return false
        const style = getComputedStyle(el)
        return style.visibility !== 'hidden' && style.display !== 'none'
      }
      const label = (el) => {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim()
        return text.replace(/\\s+/g, ' ').slice(0, 80)
      }
      document.querySelectorAll('[data-lucky-ai-id]').forEach((el) => el.removeAttribute('data-lucky-ai-id'))
      const items = []
      let id = 0
      for (const el of document.querySelectorAll(selector)) {
        if (items.length >= ${limit}) break
        if (!visible(el)) continue
        id += 1
        el.setAttribute('data-lucky-ai-id', String(id))
        const tag = el.tagName.toLowerCase()
        const item = { id, tag, label: label(el) }
        item.enabled = !(Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true')
        item.readonly = Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true'
        if (tag === 'a') item.href = (el.getAttribute('href') || '').slice(0, 200)
        // 凭证防护：密码框与敏感 autocomplete 字段只暴露存在性，绝不采集值
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase()
        const sensitive = (tag === 'input' && el.type === 'password')
          || /(^|\\s)(current-password|new-password|cc-number|cc-csc|one-time-code)(\\s|$)/.test(autocomplete)
        if (tag === 'input') {
          item.type = el.type || 'text'
          item.value = sensitive ? '[REDACTED:sensitive-field]' : String(el.value || '').slice(0, 80)
        }
        if (tag === 'select') item.value = String(el.value || '').slice(0, 80)
        if (tag === 'textarea') item.value = sensitive ? '[REDACTED:sensitive-field]' : String(el.value || '').slice(0, 80)
        items.push(item)
      }
      return items
    })()`

    const elements = await wc.executeJavaScript(script, false).catch(() => []) as Array<Record<string, unknown>>
    return { url: wc.getURL(), title: wc.getTitle(), elements }
  }

  /** 点击快照序号对应的元素（滚动进视口后触发 click），返回动作后的页面状态。 */
  async clickElement(elementId: number, tabId?: string): Promise<{ ok: boolean; url: string; title: string; error?: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { ok: false, url: '', title: '', error: '内嵌浏览器没有打开的页面' }

    logger.info('click browser element requested', { elementId, tabId })
    const target = await this.resolveActionableElement(wc, elementId, 'click')
    if (!target.ok || target.x == null || target.y == null) {
      return {
        ok: false,
        url: wc.getURL(),
        title: wc.getTitle(),
        error: this.describeActionabilityError(target, '点击失败')
      }
    }
    await delay(USER_VISIBLE_ACTION_DELAY_MS)
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(target.x), y: Math.round(target.y) })
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 })
    // 点击可能触发导航，稍候并等待加载收敛
    await delay(400)
    const ready = (await this.waitUntilReady(8000, () => this.resolveWebContents(tabId))) ?? wc
    return { ok: true, url: ready.getURL(), title: ready.getTitle() }
  }

  /** 向快照序号对应的输入框填值（原生 setter + input/change 事件，兼容 React/Vue 受控组件）。 */
  async fillInput(elementId: number, value: string, tabId?: string): Promise<{ ok: boolean; error?: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { ok: false, error: '内嵌浏览器没有打开的页面' }

    logger.info('fill browser input requested', { elementId, tabId, valueLength: value.length })
    const target = await this.resolveActionableElement(wc, elementId, 'fill')
    if (!target.ok) {
      return { ok: false, error: this.describeActionabilityError(target, '填写失败') }
    }
    await delay(USER_VISIBLE_ACTION_DELAY_MS)
    const script = `(() => {
      const el = document.querySelector('[data-lucky-ai-id="${Math.floor(elementId)}"]')
      if (!el) return 'stale'
      const tag = el.tagName.toLowerCase()
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return 'not-input'
      el.focus()
      const value = ${JSON.stringify(value)}
      if (tag === 'select') {
        el.value = value
      } else {
        const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, value)
        else el.value = value
        if (typeof el.setSelectionRange === 'function') el.setSelectionRange(value.length, value.length)
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    })()`
    const result = await wc.executeJavaScript(script, true).catch((e) => `error:${String(e)}`) as string
    if (result === 'ok') return { ok: true }
    return {
      ok: false,
      error: result === 'stale'
        ? '元素序号已失效（页面已变化），请重新 SnapshotBrowserPage 后再操作'
        : result === 'not-input'
          ? '目标元素不是输入框/下拉框'
          : `填写失败: ${result}`
    }
  }

  /**
   * 页面滚动：down/up 按 0.85 视口高度步进，top/bottom 直达。
   * 返回滚动后的位置信息，atBottom 供 Agent 判断"读完了没有"。
   */
  async scrollPage(
    direction: 'down' | 'up' | 'top' | 'bottom',
    tabId?: string
  ): Promise<{ ok: boolean; scrollY: number; scrollHeight: number; atBottom: boolean; error?: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { ok: false, scrollY: 0, scrollHeight: 0, atBottom: false, error: '内嵌浏览器没有打开的页面' }
    const script = `(() => {
      const dir = ${JSON.stringify(direction)}
      const step = Math.round(window.innerHeight * 0.85)
      if (dir === 'down') window.scrollBy({ top: step, behavior: 'instant' })
      else if (dir === 'up') window.scrollBy({ top: -step, behavior: 'instant' })
      else if (dir === 'top') window.scrollTo({ top: 0, behavior: 'instant' })
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      const scrollY = Math.round(window.scrollY)
      const scrollHeight = document.documentElement.scrollHeight
      return { scrollY, scrollHeight, atBottom: scrollY + window.innerHeight >= scrollHeight - 4 }
    })()`
    // 无限滚动页面需要一拍加载新内容
    const result = await wc.executeJavaScript(script, true).catch(() => null) as
      | { scrollY: number; scrollHeight: number; atBottom: boolean }
      | null
    if (!result) return { ok: false, scrollY: 0, scrollHeight: 0, atBottom: false, error: '滚动失败' }
    await delay(250)
    return { ok: true, ...result }
  }

  /** 发送真实键盘事件（Enter 提交搜索、Escape 关弹层、Tab 移动焦点等）。 */
  async pressKey(
    key: 'Enter' | 'Escape' | 'Tab' | 'ArrowDown' | 'ArrowUp' | 'PageDown' | 'PageUp',
    tabId?: string
  ): Promise<{ ok: boolean; url: string; title: string; error?: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { ok: false, url: '', title: '', error: '内嵌浏览器没有打开的页面' }
    logger.info('press browser key requested', { key, tabId })
    await delay(USER_VISIBLE_ACTION_DELAY_MS)
    wc.sendInputEvent({ type: 'keyDown', keyCode: key })
    if (key === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: key })
    // Enter 可能触发导航/提交
    await delay(300)
    const ready = (await this.waitUntilReady(6000, () => this.resolveWebContents(tabId))) ?? wc
    return { ok: true, url: ready.getURL(), title: ready.getTitle() }
  }

  /** 悬停元素（真实 mouseMove，用于展开 hover 菜单/悬浮卡片）。 */
  async hoverElement(elementId: number, tabId?: string): Promise<{ ok: boolean; error?: string }> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return { ok: false, error: '内嵌浏览器没有打开的页面' }
    const target = await this.resolveActionableElement(wc, elementId, 'click')
    if (!target.ok || target.x == null || target.y == null) {
      return { ok: false, error: this.describeActionabilityError(target, '悬停失败') }
    }
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(target.x), y: Math.round(target.y) })
    // 给 hover 触发的浮层留出现时间
    await delay(350)
    return { ok: true }
  }

  /**
   * 等待页面出现指定文本（SPA 点击后无导航、内容异步渲染的场景）。
   * 上限 20s；返回实际耗时供 Agent 判断页面响应速度。
   */
  async waitForText(text: string, timeoutMs = 8000, tabId?: string): Promise<{ found: boolean; elapsedMs: number }> {
    const query = text.trim().slice(0, 200)
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 500), 20_000)
    const startedAt = Date.now()
    if (!query) return { found: false, elapsedMs: 0 }
    while (Date.now() < deadline) {
      const wc = this.resolveWebContents(tabId)
      if (wc) {
        const found = await wc.executeJavaScript(
          `document.body ? document.body.innerText.includes(${JSON.stringify(query)}) : false`,
          false
        ).catch(() => false) as boolean
        if (found) return { found: true, elapsedMs: Date.now() - startedAt }
      }
      await delay(250)
    }
    return { found: false, elapsedMs: Date.now() - startedAt }
  }

  /**
   * 页面截图（视觉通道）：等比缩至宽 ≤1024，JPEG 压缩控制 token 成本。
   * 返回 base64 供工具层组装为图片块，交给视觉模型判断布局/异常。
   */
  async captureScreenshot(tabId?: string): Promise<{ base64: string; mediaType: string; width: number; height: number } | null> {
    let wc = this.resolveWebContents(tabId)
    if (!wc) return null
    if (wc.isLoadingMainFrame()) wc = (await this.waitUntilReady(DEFAULT_TIMEOUT, () => this.resolveWebContents(tabId))) ?? wc
    const image = await wc.capturePage().catch(() => null)
    if (!image || image.isEmpty()) return null
    const size = image.getSize()
    const scaled = size.width > 1024 ? image.resize({ width: 1024 }) : image
    const finalSize = scaled.getSize()
    return {
      base64: scaled.toJPEG(75).toString('base64'),
      mediaType: 'image/jpeg',
      width: finalSize.width,
      height: finalSize.height
    }
  }

  async navigate(action: 'back' | 'forward' | 'reload', tabId?: string): Promise<{ url: string; title: string } | null> {
    const wc = this.resolveWebContents(tabId)
    if (!wc) return null
    if (action === 'back') {
      if (!this.canGoBack(wc)) throw new Error('没有可后退的历史记录')
      wc.navigationHistory.goBack()
    } else if (action === 'forward') {
      if (!this.canGoForward(wc)) throw new Error('没有可前进的历史记录')
      wc.navigationHistory.goForward()
    } else {
      wc.reload()
    }
    const ready = (await this.waitUntilReady()) ?? wc
    return { url: ready.getURL(), title: ready.getTitle() }
  }
}

export const browserControlService = new BrowserControlService()
