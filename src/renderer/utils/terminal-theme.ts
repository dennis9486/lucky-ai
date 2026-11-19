import type { ITheme } from 'xterm'

/** 浅色终端 — 更高对比度，避免 ANSI white 过淡 */
export const TERMINAL_THEME_LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#1a1a1a',
  black: '#1a1a1a',
  red: '#c42b2b',
  green: '#087a2a',
  yellow: '#8a6100',
  blue: '#005fb8',
  magenta: '#a626a4',
  cyan: '#0078a8',
  white: '#525252',
  brightBlack: '#6e6e6e',
  brightRed: '#e03131',
  brightGreen: '#2ea043',
  brightYellow: '#bf8700',
  brightBlue: '#0969da',
  brightMagenta: '#bf3989',
  brightCyan: '#0891b2',
  brightWhite: '#0d0d0d'
}

/** 深色终端 — 提高前景与亮色对比 */
export const TERMINAL_THEME_DARK: ITheme = {
  background: '#1e1e1e',
  foreground: '#ececec',
  cursor: '#ececec',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#1e1e1e',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b3b3b3',
  brightBlack: '#8b949e',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff'
}

export function resolveTerminalTheme(mode: 'light' | 'dark'): ITheme {
  return mode === 'dark' ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT
}
