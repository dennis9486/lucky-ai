import type * as Monaco from 'monaco-editor'
import type { MonacoRuntime } from './monaco-runtime.service.js'

export type EditorPaneId = 'primary' | 'secondary'

interface PaneRegistration {
  pane: EditorPaneId
  runtime: MonacoRuntime
  editor: Monaco.editor.IStandaloneCodeEditor
  tabPath: () => string | null
}

const panes = new Map<EditorPaneId, PaneRegistration>()

export function registerMonacoPane(registration: PaneRegistration): void {
  panes.set(registration.pane, registration)
}

export function unregisterMonacoPane(pane: EditorPaneId): void {
  panes.delete(pane)
}

export function getMonacoPane(pane: EditorPaneId): PaneRegistration | null {
  return panes.get(pane) ?? null
}

export function getMonacoPaneForPath(tabPath: string): PaneRegistration | null {
  for (const registration of panes.values()) {
    if (registration.tabPath() === tabPath) return registration
  }
  return null
}

export function getActiveMonacoPane(focusedPane: EditorPaneId): PaneRegistration | null {
  return panes.get(focusedPane) ?? panes.get('primary') ?? null
}
