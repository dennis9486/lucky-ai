import type { AppLocale } from '../types/locale.js'

export type RuntimeLocale = 'zh-CN' | 'en-US'

export const BROWSER_CONTEXT_MENU_MESSAGES = {
  'zh-CN': {
    back: '返回',
    forward: '前进',
    reload: '刷新',
    exitFullscreen: '退出全屏模式',
    openLinkInNewTab: '在新标签页中打开链接',
    copyLinkAddress: '复制链接地址',
    copyImage: '复制图片',
    copyImageAddress: '复制图片地址',
    copy: '复制',
    cut: '剪切',
    paste: '粘贴',
    selectAll: '全选',
    searchSelection: '搜索选中内容',
    print: '打印...',
    copyPageUrl: '复制页面网址',
    monitorPage: '监控此页面变化',
    monitorPageWithAi: '监控并让 AI 分析变化',
    agentPolicyMenu: 'AI 操作授权（此站点）',
    agentPolicyAuto: '允许自动操作（免确认）',
    agentPolicyAsk: '每次操作需确认（默认）',
    agentPolicyBlock: '禁止 AI 操作',
    aiSummarizePage: 'AI 总结此页',
    aiExplainSelection: 'AI 解释选中内容',
    viewSource: '显示网页源代码',
    inspect: '检查元素'
  },
  'en-US': {
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    exitFullscreen: 'Exit Full Screen',
    openLinkInNewTab: 'Open Link in New Tab',
    copyLinkAddress: 'Copy Link Address',
    copyImage: 'Copy Image',
    copyImageAddress: 'Copy Image Address',
    copy: 'Copy',
    cut: 'Cut',
    paste: 'Paste',
    selectAll: 'Select All',
    searchSelection: 'Search for Selection',
    print: 'Print...',
    copyPageUrl: 'Copy Page URL',
    monitorPage: 'Watch This Page for Changes',
    monitorPageWithAi: 'Watch and Analyze Changes with AI',
    agentPolicyMenu: 'AI Action Permission (This Site)',
    agentPolicyAuto: 'Allow Automatic Actions (No Confirmation)',
    agentPolicyAsk: 'Confirm Each Action (Default)',
    agentPolicyBlock: 'Block AI Actions',
    aiSummarizePage: 'Summarize Page with AI',
    aiExplainSelection: 'Explain Selection with AI',
    viewSource: 'View Page Source',
    inspect: 'Inspect Element'
  }
} as const

export type BrowserContextMenuMessageKey = keyof typeof BROWSER_CONTEXT_MENU_MESSAGES['zh-CN']

export function resolveRuntimeLocale(preference: AppLocale, systemLocale = 'en-US'): RuntimeLocale {
  if (preference === 'zh-CN' || preference === 'en-US') return preference
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function createBrowserContextMenuTranslator(locale: RuntimeLocale): (key: BrowserContextMenuMessageKey) => string {
  const messages = BROWSER_CONTEXT_MENU_MESSAGES[locale]
  return (key) => messages[key]
}
