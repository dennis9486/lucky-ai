import { defineStore } from 'pinia'
import { tGlobal } from '../i18n/index.js'
import { ref } from 'vue'
import {
  DEFAULT_THEME_SETTINGS,
  THEME_PRESETS,
  type ThemeMode,
  type ThemePalette,
  type ThemePreset,
  type ThemeSettings
} from '../../shared/types/theme.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { toIpcPlain } from '../utils/ipc-serialize.js'
import { applyTheme } from '../utils/theme-apply.js'

export const useThemeStore = defineStore('theme', () => {
  const settings = ref<ThemeSettings>(structuredClone(DEFAULT_THEME_SETTINGS))
  const resolvedMode = ref<'light' | 'dark'>('light')
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let mediaQuery: MediaQueryList | null = null
  let motionQuery: MediaQueryList | null = null

  function apply(): void {
    resolvedMode.value = applyTheme(settings.value)
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void save()
    }, 400)
  }

  async function load(): Promise<void> {
    const data = await unwrap<{ theme?: ThemeSettings }>(ipc.settings.get())
    settings.value = {
      ...DEFAULT_THEME_SETTINGS,
      ...data.theme,
      light: { ...DEFAULT_THEME_SETTINGS.light, ...data.theme?.light },
      dark: { ...DEFAULT_THEME_SETTINGS.dark, ...data.theme?.dark }
    }
    apply()
  }

  async function save(): Promise<void> {
    await unwrap(ipc.settings.set(toIpcPlain({ theme: settings.value })))
  }

  function patch(partial: Partial<ThemeSettings>): void {
    settings.value = { ...settings.value, ...partial }
    apply()
    scheduleSave()
  }

  function setMode(mode: ThemeMode): void {
    patch({ mode })
  }

  function setPreset(preset: ThemePreset): void {
    settings.value = {
      ...settings.value,
      preset,
      light: { ...THEME_PRESETS[preset].light },
      dark: { ...THEME_PRESETS[preset].dark }
    }
    apply()
    scheduleSave()
  }

  function updatePalette(scope: 'light' | 'dark', partial: Partial<ThemePalette>): void {
    settings.value = {
      ...settings.value,
      [scope]: { ...settings.value[scope], ...partial }
    }
    apply()
    scheduleSave()
  }

  function importTheme(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>
      if (!parsed.light || !parsed.dark) {
        return tGlobal('themeEditor.themeNeedsLightDark')
      }
      settings.value = {
        ...settings.value,
        ...parsed,
        light: { ...settings.value.light, ...parsed.light },
        dark: { ...settings.value.dark, ...parsed.dark }
      }
      apply()
      scheduleSave()
      return null
    } catch {
      return tGlobal('themeEditor.parseError')
    }
  }

  function exportTheme(): string {
    return JSON.stringify(settings.value, null, 2)
  }

  function bindSystemListeners(): void {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    const onSystemChange = (): void => {
      if (settings.value.mode === 'system' || settings.value.reduceMotion === 'system') {
        apply()
      }
    }

    mediaQuery.addEventListener('change', onSystemChange)
    motionQuery.addEventListener('change', onSystemChange)
  }

  return {
    settings,
    resolvedMode,
    load,
    save,
    apply,
    patch,
    setMode,
    setPreset,
    updatePalette,
    importTheme,
    exportTheme,
    bindSystemListeners
  }
})
