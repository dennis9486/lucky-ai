export type AppLocale = 'system' | 'zh-CN' | 'en-US'

export const DEFAULT_LOCALE: AppLocale = 'system'

export function resolveAppLocale(preference: AppLocale): 'zh-CN' | 'en-US' {
  if (preference === 'zh-CN' || preference === 'en-US') return preference
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US'
}
