export interface EditorStatusSnapshot {
  lineNumber: number
  column: number
  languageId: string
  eol: 'LF' | 'CRLF'
  indentSize: number
  insertSpaces: boolean
}

let statusGetter: (() => EditorStatusSnapshot | null) | null = null
const statusSubscribers = new Set<(status: EditorStatusSnapshot | null) => void>()

export function registerEditorStatus(getter: () => EditorStatusSnapshot | null): void {
  statusGetter = getter
  notifyEditorStatus()
}

export function unregisterEditorStatus(): void {
  statusGetter = null
  notifyEditorStatus()
}

export function getEditorStatus(): EditorStatusSnapshot | null {
  return statusGetter?.() ?? null
}

export function notifyEditorStatus(): void {
  const snapshot = getEditorStatus()
  for (const subscriber of statusSubscribers) subscriber(snapshot)
}

export function subscribeEditorStatus(
  callback: (status: EditorStatusSnapshot | null) => void
): () => void {
  statusSubscribers.add(callback)
  callback(getEditorStatus())
  return () => statusSubscribers.delete(callback)
}
