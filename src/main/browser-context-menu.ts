/**
 * browser-context-menu.ts — 内嵌浏览器（webview）右键菜单
 *
 * 对齐主流浏览器的最小集合：返回/前进/刷新、链接（新标签打开/复制地址）、
 * 图片（复制图片/复制图片地址）、文本（复制/剪切/粘贴/搜索）、
 * 页面操作（打印/复制网址/查看源码）、检查元素。
 * 「新标签打开」复用既有的 BROWSER_OPEN_URL_IN_NEW_TAB 通道（与 target=_blank
 * 转发同一条路），由渲染进程的浏览器标签页模型消费。
 *
 * 文案统一走 shared i18n 资源；主进程只负责按设置语言取 translator。
 */

import { app, BrowserWindow, Menu, clipboard, type WebContents, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/ipc-channels.js'
import { createBrowserContextMenuTranslator, resolveRuntimeLocale } from '../shared/i18n/browser-context-menu.js'
import { BROWSER_SEARCH_URLS } from '../shared/types/browser.js'
import { createLogger } from '../shared/utils/log.js'
import { settingsService } from './services/settings.service.js'
import { pageMonitorService } from './services/page-monitor.service.js'
import { sitePermissionService } from './services/site-permission.service.js'

const logger = createLogger('main/browser-context-menu')

/** 给 webview 挂载右键菜单（在 web-contents-created 钩子中调用一次） */
export function attachWebviewContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    void showMenu(contents, params)
  })
}

async function showMenu(contents: WebContents, params: ContextMenuParams): Promise<void> {
  if (contents.isDestroyed()) return
  const t = await createMenuTranslator()
  const template: MenuItemConstructorOptions[] = []
  const host = contents.hostWebContents
  const hostWindow = host && !host.isDestroyed() ? BrowserWindow.fromWebContents(host) : null
  const pageURL = contents.getURL()
  const hasPage = Boolean(pageURL)
  const openInNewTab = (url: string): void => {
    if (host && !host.isDestroyed()) host.send(IPC_CHANNELS.BROWSER_OPEN_URL_IN_NEW_TAB, url)
  }

  // ── 导航 ───────────────────────────────────────────────
  if (hostWindow?.isFullScreen()) {
    template.push(
      { label: t('exitFullscreen'), click: () => hostWindow.setFullScreen(false) },
      { type: 'separator' }
    )
  }
  template.push(
    { label: t('back'), enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
    { label: t('forward'), enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
    { label: t('reload'), click: () => contents.reload() }
  )

  // ── 链接 ───────────────────────────────────────────────
  if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
    const linkURL = params.linkURL
    template.push(
      { type: 'separator' },
      {
        label: t('openLinkInNewTab'),
        click: () => openInNewTab(linkURL)
      },
      { label: t('copyLinkAddress'), click: () => clipboard.writeText(linkURL) }
    )
  }

  // ── 图片 ───────────────────────────────────────────────
  if (params.mediaType === 'image' && params.srcURL) {
    const { x, y } = params
    const srcURL = params.srcURL
    template.push(
      { type: 'separator' },
      { label: t('copyImage'), click: () => contents.copyImageAt(x, y) },
      { label: t('copyImageAddress'), click: () => clipboard.writeText(srcURL) }
    )
  }

  // ── 文本编辑 ────────────────────────────────────────────
  if (params.isEditable || params.selectionText) {
    template.push({ type: 'separator' })
    if (params.isEditable) {
      template.push(
        { label: t('cut'), enabled: Boolean(params.selectionText), click: () => contents.cut() },
        { label: t('copy'), enabled: Boolean(params.selectionText), click: () => contents.copy() },
        { label: t('paste'), click: () => contents.paste() },
        { label: t('selectAll'), click: () => contents.selectAll() }
      )
    } else {
      template.push({ label: t('copy'), click: () => contents.copy() })
    }
    if (params.selectionText?.trim()) {
      const query = params.selectionText.trim()
      template.push({
        label: t('searchSelection'),
        click: () => { void openSearchInNewTab(query, openInNewTab) }
      })
      template.push({
        label: t('aiExplainSelection'),
        click: () => sendChatPrompt(
          contents,
          // 选中文本作为被引用的数据传给 AI；浏览器 AI 面板会补充当前页面上下文。
          `解释当前网页中的这段选中内容，给出背景、要点和必要的上下文：\n\n"""\n${query.slice(0, 2000)}\n"""`
        )
      })
    }
  }

  // ── 页面操作 ────────────────────────────────────────────
  template.push(
    { type: 'separator' },
    { label: t('print'), enabled: hasPage, click: () => contents.print() },
    { label: t('copyPageUrl'), enabled: hasPage, click: () => clipboard.writeText(pageURL) },
    {
      label: t('aiSummarizePage'),
      enabled: /^https?:\/\//i.test(pageURL),
      click: () => sendChatPrompt(
        contents,
        `总结当前网页的核心内容与要点；如果页面很长，请分段阅读后再归纳。`
      )
    },
    {
      label: t('monitorPage'),
      enabled: /^https?:\/\//i.test(pageURL),
      click: () => {
        try {
          pageMonitorService.create(pageURL, contents.getTitle())
        } catch (e) {
          logger.warn('create page monitor failed', { pageURL, error: String(e) })
        }
      }
    },
    {
      label: t('agentPolicyMenu'),
      enabled: /^https?:\/\//i.test(pageURL),
      submenu: buildAgentPolicySubmenu(pageURL, t)
    },
    {
      label: t('monitorPageWithAi'),
      enabled: /^https?:\/\//i.test(pageURL),
      click: () => {
        try {
          pageMonitorService.create(pageURL, contents.getTitle(), 30, true)
        } catch (e) {
          logger.warn('create ai page monitor failed', { pageURL, error: String(e) })
        }
      }
    },
    {
      label: t('viewSource'),
      enabled: /^https?:\/\//i.test(pageURL),
      click: () => openInNewTab(`view-source:${pageURL}`)
    }
  )

  // ── 开发者 ─────────────────────────────────────────────
  template.push(
    { type: 'separator' },
    { label: t('inspect'), click: () => contents.inspectElement(params.x, params.y) }
  )

  Menu.buildFromTemplate(template).popup()
}

async function createMenuTranslator(): Promise<ReturnType<typeof createBrowserContextMenuTranslator>> {
  try {
    const settings = await settingsService.getSettings()
    return createBrowserContextMenuTranslator(resolveRuntimeLocale(settings.locale, app.getLocale()))
  } catch {
    return createBrowserContextMenuTranslator(resolveRuntimeLocale('system', app.getLocale()))
  }
}

/** 「AI 操作授权」子菜单：radio 三态（auto/ask/block），立即生效 */
function buildAgentPolicySubmenu(
  pageURL: string,
  t: (key: 'agentPolicyAuto' | 'agentPolicyAsk' | 'agentPolicyBlock') => string
): MenuItemConstructorOptions[] {
  const origin = (() => {
    try {
      return new URL(pageURL).origin
    } catch {
      return ''
    }
  })()
  const current = sitePermissionService.getAgentPolicy(origin)
  const item = (policy: 'auto' | 'ask' | 'block', label: string): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: current === policy,
    click: () => sitePermissionService.setAgentPolicy(origin, policy)
  })
  return [
    item('auto', t('agentPolicyAuto')),
    item('ask', t('agentPolicyAsk')),
    item('block', t('agentPolicyBlock'))
  ]
}

/** 把 AI 阅读类 prompt 发给渲染进程：由浏览器 AI 面板消费，避免离开当前网页。 */
function sendChatPrompt(contents: WebContents, prompt: string): void {
  const host = contents.hostWebContents
  if (host && !host.isDestroyed()) host.send(IPC_CHANNELS.CHAT_SEND_PROMPT, prompt)
}

async function openSearchInNewTab(text: string, openInNewTab: (url: string) => void): Promise<void> {
  try {
    const settings = await settingsService.getSettings()
    const prefix = BROWSER_SEARCH_URLS[settings.general.browserSearchEngine] ?? BROWSER_SEARCH_URLS.duckduckgo
    openInNewTab(`${prefix}${encodeURIComponent(text)}`)
  } catch {
    openInNewTab(`${BROWSER_SEARCH_URLS.duckduckgo}${encodeURIComponent(text)}`)
  }
}
