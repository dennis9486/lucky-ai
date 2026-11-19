import { describe, expect, it } from 'vitest'
import {
  BROWSER_CONTEXT_MENU_MESSAGES,
  createBrowserContextMenuTranslator,
  resolveRuntimeLocale
} from './browser-context-menu.js'

describe('browser context menu i18n', () => {
  it('keeps zh-CN and en-US message keys in sync', () => {
    const zhKeys = Object.keys(BROWSER_CONTEXT_MENU_MESSAGES['zh-CN']).sort()
    const enKeys = Object.keys(BROWSER_CONTEXT_MENU_MESSAGES['en-US']).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('has no empty message values', () => {
    const emptyKeys = Object.entries(BROWSER_CONTEXT_MENU_MESSAGES).flatMap(([locale, messages]) =>
      Object.entries(messages)
        .filter(([, value]) => !value.trim())
        .map(([key]) => `${locale}.${key}`)
    )
    expect(emptyKeys).toEqual([])
  })

  it('resolves system locale from Electron locale text', () => {
    expect(resolveRuntimeLocale('system', 'zh-Hans')).toBe('zh-CN')
    expect(resolveRuntimeLocale('system', 'en-MY')).toBe('en-US')
  })

  it('creates a typed translator by locale', () => {
    const t = createBrowserContextMenuTranslator('en-US')
    expect(t('copy')).toBe('Copy')
  })
})
