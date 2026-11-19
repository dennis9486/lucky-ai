export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePreset = 'default' | 'codex'
export type ReduceMotion = 'system' | 'on' | 'off'
export type DiffMarkers = 'color' | 'plus-minus'
export type DockIconStyle = 'default' | 'codex-light' | 'codex-dark'

export interface ThemePalette {
  accent: string
  background: string
  foreground: string
  contrast: number
  translucentSidebar: boolean
}

export interface ThemeSettings {
  mode: ThemeMode
  preset: ThemePreset
  light: ThemePalette
  dark: ThemePalette
  uiFont: string
  codeFont: string
  uiFontSize: number
  codeFontSize: number
  usePointerCursor: boolean
  reduceMotion: ReduceMotion
  diffMarkers: DiffMarkers
  fontSmoothing: boolean
  dockIcon: DockIconStyle
}

export const DEFAULT_UI_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
export const DEFAULT_CODE_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

export const THEME_PRESETS: Record<ThemePreset, { light: ThemePalette; dark: ThemePalette }> = {
  default: {
    light: {
      accent: '#2563eb',
      background: '#ffffff',
      foreground: '#1a1a1a',
      contrast: 42,
      translucentSidebar: true
    },
    dark: {
      accent: '#0ea5e9',
      background: '#141414',
      foreground: '#ececec',
      contrast: 68,
      translucentSidebar: true
    }
  },
  codex: {
    light: {
      accent: '#339cff',
      background: '#ffffff',
      foreground: '#1a1a1a',
      contrast: 45,
      translucentSidebar: true
    },
    dark: {
      accent: '#339cff',
      background: '#0d0d0d',
      foreground: '#ececec',
      contrast: 60,
      translucentSidebar: true
    }
  }
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: 'system',
  preset: 'codex',
  light: { ...THEME_PRESETS.codex.light },
  dark: { ...THEME_PRESETS.codex.dark },
  uiFont: DEFAULT_UI_FONT,
  codeFont: DEFAULT_CODE_FONT,
  uiFontSize: 14,
  codeFontSize: 12,
  usePointerCursor: false,
  reduceMotion: 'system',
  diffMarkers: 'color',
  fontSmoothing: true,
  dockIcon: 'default'
}
