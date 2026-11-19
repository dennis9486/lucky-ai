import { createI18n } from 'vue-i18n'
import zhCN from '../locales/zh-CN.json'
import enUS from '../locales/en-US.json'
import type { AppLocale } from '../../shared/types/locale.js'
import { resolveAppLocale } from '../../shared/types/locale.js'

export const i18n = createI18n({
  legacy: false,
  locale: resolveAppLocale('system'),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

export function applyAppLocale(preference: AppLocale): void {
  i18n.global.locale.value = resolveAppLocale(preference)
}

/** 在非 Vue 模块（store / utils）中使用 */
export function tGlobal(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

export function sessionDefaultTitle(): string {
  return tGlobal('session.defaultTitle')
}
