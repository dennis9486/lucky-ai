const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export function editorShortcut(parts: string[]): string {
  if (!isMac) {
    return parts
      .map((part) => part
        .replace('⌘', 'Ctrl+')
        .replace('⇧', 'Shift+')
        .replace('⌥', 'Alt+')
        .replace('⌃', 'Ctrl+'))
      .join('')
  }
  return parts.join('')
}
