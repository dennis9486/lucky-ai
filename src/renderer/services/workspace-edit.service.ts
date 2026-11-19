import type * as Monaco from 'monaco-editor'
import { resolveWorkspaceFilePath } from '../../shared/utils/workspace-path.js'
import { useEditorStore } from '../stores/editor.store.js'

export async function applyWorkspaceEdit(
  monaco: typeof Monaco,
  edit: Monaco.languages.WorkspaceEdit,
  workspaceRoot: string | null | undefined
): Promise<void> {
  const editor = useEditorStore()
  const edits = edit.edits ?? []

  for (const item of edits) {
    if (!('textEdit' in item)) continue
    const resourcePath = item.resource.fsPath
    const tabPath = toTabPath(resourcePath, workspaceRoot)
    const model = monaco.editor.getModel(item.resource)
    const range = item.textEdit.range
    const text = item.textEdit.text

    if (model) {
      model.pushEditOperations([], [{ range, text }], () => null)
      if (tabPath) editor.syncTabBuffer(tabPath, model.getValue(), model.getAlternativeVersionId())
      continue
    }

    if (!tabPath) continue
    const tab = editor.tabs.find((entry) => entry.path === tabPath)
    if (!tab) {
      await editor.openFile(tabPath)
    }
    const target = editor.tabs.find((entry) => entry.path === tabPath)
    if (!target) continue
    const next = applyTextEdit(target.content, range, text)
    editor.updateContent(tabPath, next)
  }
}

function toTabPath(absPath: string, workspaceRoot: string | null | undefined): string | null {
  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  const normalized = absPath.replace(/\\/g, '/')
  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1)
  }
  try {
    return resolveWorkspaceFilePath(normalized, workspaceRoot)
  } catch {
    return null
  }
}

function applyTextEdit(content: string, range: Monaco.IRange, text: string): string {
  const lines = content.split('\n')
  const startLine = Math.max(1, range.startLineNumber)
  const endLine = Math.max(startLine, range.endLineNumber)
  const before = lines.slice(0, startLine - 1)
  const after = lines.slice(endLine)
  const startText = lines[startLine - 1] ?? ''
  const endText = lines[endLine - 1] ?? ''
  const prefix = startText.slice(0, Math.max(0, range.startColumn - 1))
  const suffix = endText.slice(Math.max(0, range.endColumn - 1))
  const inserted = text.split('\n')

  if (inserted.length === 1) {
    return [...before, `${prefix}${inserted[0] ?? ''}${suffix}`, ...after].join('\n')
  }

  const mergedStart = `${prefix}${inserted[0] ?? ''}`
  const mergedEnd = `${inserted.at(-1) ?? ''}${suffix}`
  return [...before, mergedStart, ...inserted.slice(1, -1), mergedEnd, ...after].join('\n')
}
