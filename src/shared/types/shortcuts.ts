export interface ShortcutKeyMatch {
  mod: boolean
  shift?: boolean
  alt?: boolean
  key: string
}

export interface ShortcutBinding {
  /** Display tokens, e.g. ['⇧', '⌘', 'N'] */
  keys: string[]
  match: ShortcutKeyMatch
}

export interface ShortcutDefinition {
  id: string
  title: string
  description: string
  bindings: ShortcutBinding[]
  unassigned?: boolean
}

export type KeyboardShortcutSettings = Record<string, ShortcutBinding[]>

export function cloneBindings(bindings: ShortcutBinding[]): ShortcutBinding[] {
  return bindings.map((binding) => ({
    keys: [...binding.keys],
    match: { ...binding.match }
  }))
}

export function eventMatchesShortcut(e: KeyboardEvent, match: ShortcutKeyMatch): boolean {
  const mod = e.metaKey || e.ctrlKey
  if (mod !== match.mod) return false
  if (match.shift !== undefined && e.shiftKey !== match.shift) return false
  if (match.alt !== undefined && e.altKey !== match.alt) return false

  if (match.key === '1-8') {
    return /^[1-8]$/.test(e.key)
  }

  if (match.key === 'Escape') {
    return e.key === 'Escape'
  }

  if (match.key === '`') {
    return e.key === '`' || e.code === 'Backquote'
  }

  return e.key.toLowerCase() === match.key.toLowerCase()
}

export function shortcutSignature(binding: ShortcutBinding): string {
  const match = binding.match
  return [
    match.mod ? 'mod' : '',
    match.shift ? 'shift' : '',
    match.alt ? 'alt' : '',
    match.key.toLowerCase()
  ].filter(Boolean).join('+')
}

export function shortcutsConflict(
  settings: KeyboardShortcutSettings,
  ownerId: string,
  binding: ShortcutBinding
): string | null {
  const signature = shortcutSignature(binding)
  for (const [id, bindings] of Object.entries(settings)) {
    if (id === ownerId) continue
    if (bindings.some((item) => shortcutSignature(item) === signature)) return id
  }
  return null
}

export function shortcutFromKeyboardEvent(e: KeyboardEvent): ShortcutBinding | null {
  if (['Alt', 'Control', 'Meta', 'Shift'].includes(e.key)) return null
  const mod = e.metaKey || e.ctrlKey
  const key = normalizeShortcutKey(e)
  const keys = [
    ...(e.shiftKey ? ['⇧'] : []),
    ...(e.altKey ? ['⌥'] : []),
    ...(mod ? ['⌘'] : []),
    displayShortcutKey(key)
  ]
  return {
    keys,
    match: { mod, shift: e.shiftKey, alt: e.altKey, key }
  }
}

function normalizeShortcutKey(e: KeyboardEvent): string {
  if (e.key === ' ') return 'Space'
  if (e.key === 'Escape') return 'Escape'
  if (e.key === '`' || e.code === 'Backquote') return '`'
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

function displayShortcutKey(key: string): string {
  if (key === 'Escape') return 'Esc'
  if (key === 'Space') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

export const KEYBOARD_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'new-chat',
    title: '新对话',
    description: 'Start a new chat',
    bindings: [
      { keys: ['⌘', 'N'], match: { mod: true, shift: false, alt: false, key: 'n' } },
      { keys: ['⇧', '⌘', 'O'], match: { mod: true, shift: true, alt: false, key: 'o' } }
    ]
  },
  {
    id: 'command-palette',
    title: '打开命令面板',
    description: 'Search files and run commands',
    bindings: [{ keys: ['⌘', 'P'], match: { mod: true, shift: false, alt: false, key: 'p' } }]
  },
  {
    id: 'save-current-file',
    title: '保存当前文件',
    description: 'Save the active editor file',
    bindings: [{ keys: ['⌘', 'S'], match: { mod: true, shift: false, alt: false, key: 's' } }]
  },
  {
    id: 'focus-composer',
    title: '聚焦聊天输入',
    description: 'Focus the chat composer',
    bindings: [{ keys: ['⌘', 'L'], match: { mod: true, shift: false, alt: false, key: 'l' } }]
  },
  {
    id: 'open-settings',
    title: '打开设置',
    description: 'Open settings',
    bindings: [{ keys: ['⌘', ','], match: { mod: true, shift: false, alt: false, key: ',' } }]
  },
  {
    id: 'toggle-terminal',
    title: '切换终端',
    description: 'Show or hide the terminal panel',
    bindings: [{ keys: ['⌘', '`'], match: { mod: true, shift: false, alt: false, key: '`' } }]
  },
  {
    id: 'stop-agent',
    title: '停止生成',
    description: 'Stop the current agent run',
    bindings: [{ keys: ['Esc'], match: { mod: false, shift: false, alt: false, key: 'Escape' } }]
  },
  {
    id: 'switch-chat',
    title: '切换到最近对话',
    description: 'Switch to recent chat 1–8',
    bindings: [{ keys: ['⌘', '1–8'], match: { mod: true, shift: false, alt: false, key: '1-8' } }]
  },
  {
    id: 'archive-chat',
    title: '归档聊天',
    description: 'Archive the current chat',
    bindings: [{ keys: ['⇧', '⌘', 'A'], match: { mod: true, shift: true, alt: false, key: 'a' } }]
  },
  {
    id: 'side-chat',
    title: '打开侧边聊天',
    description: 'Open the current chat in a side chat',
    bindings: [{ keys: ['⌘', 'B'], match: { mod: true, shift: false, alt: false, key: 'b' } }]
  },
  {
    id: 'new-window',
    title: '在新窗口中打开',
    description: 'Open the current chat in a new window',
    bindings: [{ keys: ['⇧', '⌘', 'N'], match: { mod: true, shift: true, alt: false, key: 'n' } }]
  },
  {
    id: 'quick-chat',
    title: '新建快速对话',
    description: 'Start a lightweight chat in the quick composer',
    bindings: [{ keys: ['⇧', '⌘', 'L'], match: { mod: true, shift: true, alt: false, key: 'l' } }]
  }
]

export const DEFAULT_KEYBOARD_SHORTCUT_SETTINGS: KeyboardShortcutSettings = Object.fromEntries(
  KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, cloneBindings(shortcut.bindings)])
)
