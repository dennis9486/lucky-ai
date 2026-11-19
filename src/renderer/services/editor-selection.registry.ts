let selectionGetter: (() => string | null) | null = null
let activePathGetter: (() => string | null) | null = null

export function registerEditorAccess(access: {
  getSelection: () => string | null
  getActivePath: () => string | null
}): void {
  selectionGetter = access.getSelection
  activePathGetter = access.getActivePath
}

export function unregisterEditorAccess(): void {
  selectionGetter = null
  activePathGetter = null
}

export function getEditorSelection(): string | null {
  const value = selectionGetter?.() ?? null
  if (!value?.trim()) return null
  return value
}

export function getActiveEditorPath(): string | null {
  return activePathGetter?.() ?? null
}
