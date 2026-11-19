import type { ThemePalette, ThemeSettings } from '../../shared/types/theme.js'
import { mixHex, relativeLuminance } from './color.js'

export type ResolvedThemeMode = 'light' | 'dark'

export function resolveThemeMode(mode: ThemeSettings['mode']): ResolvedThemeMode {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function paletteTokens(palette: ThemePalette): Record<string, string> {
  const contrast = palette.contrast / 100
  const secondary = mixHex(palette.background, palette.foreground, 0.35 + contrast * 0.25)
  const muted = mixHex(palette.background, palette.foreground, 0.22 + contrast * 0.18)
  const border = mixHex(palette.background, palette.foreground, 0.12 + contrast * 0.08)
  const hover = mixHex(palette.background, palette.foreground, 0.06 + contrast * 0.04)
  const sidebar = mixHex(palette.background, palette.foreground, 0.04)
  const sidebarHover = mixHex(palette.background, palette.foreground, 0.08)
  const isDarkSurface = relativeLuminance(palette.background) < 0.18
  const composerSurface = mixHex(
    palette.background,
    palette.foreground,
    isDarkSurface ? 0.02 : 0.035
  )
  const composerBar = composerSurface
  const editorChrome = mixHex(palette.background, palette.foreground, 0.05)

  return {
    '--codex-bg': palette.background,
    '--codex-sidebar': sidebar,
    '--codex-sidebar-hover': sidebarHover,
    '--codex-composer-surface': composerSurface,
    '--codex-composer-bar': composerBar,
    '--codex-editor-chrome': editorChrome,
    '--codex-text': palette.foreground,
    '--codex-text-secondary': secondary,
    '--codex-muted': muted,
    '--codex-border': border,
    '--codex-border-hover': mixHex(border, palette.foreground, 0.35),
    '--codex-hover': hover,
    '--codex-accent': palette.accent,
    '--codex-accent-hover': mixHex(palette.accent, '#000000', 0.15)
  }
}

function shouldReduceMotion(settings: ThemeSettings): boolean {
  if (settings.reduceMotion === 'on') return true
  if (settings.reduceMotion === 'off') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function applyTheme(settings: ThemeSettings): ResolvedThemeMode {
  const resolved = resolveThemeMode(settings.mode)
  const palette = resolved === 'dark' ? settings.dark : settings.light
  const root = document.documentElement

  root.dataset.theme = resolved
  root.dataset.translucentSidebar = palette.translucentSidebar ? 'true' : 'false'
  root.dataset.diffMarkers = settings.diffMarkers
  root.dataset.reduceMotion = shouldReduceMotion(settings) ? 'true' : 'false'
  root.style.colorScheme = resolved
  root.style.fontFamily = settings.uiFont
  root.style.fontSize = `${settings.uiFontSize}px`
  root.style.setProperty('--codex-code-font', settings.codeFont)
  root.style.setProperty('--codex-code-font-size', `${settings.codeFontSize}px`)

  if (settings.fontSmoothing) {
    root.classList.add('font-smoothing')
  } else {
    root.classList.remove('font-smoothing')
  }

  if (settings.usePointerCursor) {
    root.classList.add('use-pointer-cursor')
  } else {
    root.classList.remove('use-pointer-cursor')
  }

  const tokens = paletteTokens(palette)
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
  }

  return resolved
}

export function themePreviewJson(
  palette: ThemePalette,
  surface: string
): string {
  return JSON.stringify(
    {
      themePreview: {
        surface,
        accent: palette.accent,
        contrast: palette.contrast
      }
    },
    null,
    2
  )
}
