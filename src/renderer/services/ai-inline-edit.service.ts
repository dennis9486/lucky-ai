import type * as Monaco from 'monaco-editor'
import { tGlobal } from '../i18n/index.js'
import type { ToolCallPartLike } from '../utils/agent-tool-path.js'
import { extractAgentEditPreview } from '../utils/agent-tool-path.js'
import { createLogger } from '../../shared/utils/log.js'
import { toWorkspaceRelativePath } from '../../shared/utils/workspace-path.js'
import { getMonacoPaneForPath, getActiveMonacoPane, type EditorPaneId } from './monaco-runtime.registry.js'
import { ipc, unwrap } from './ipc-client.js'
import { useEditorStore } from '../stores/editor.store.js'
import { useProjectStore } from '../stores/project.store.js'

interface PendingInlineEdit {
  path: string
  toolId: string
  range: Monaco.IRange
  previewText: string
}

interface FileSnapshot {
  path: string
  relativePath: string
  content: string
}

let focusedPane: EditorPaneId = 'primary'
const pending = new Map<string, PendingInlineEdit>()
const snapshots = new Map<string, FileSnapshot>()
const logger = createLogger('renderer/inline-edit')

export function setInlineEditFocusedPane(pane: EditorPaneId): void {
  focusedPane = pane
}

export async function previewAgentToolEdit(part: ToolCallPartLike & { id?: string }): Promise<void> {
  const preview = extractAgentEditPreview(part)
  if (!preview || !part.id) return

  await ensureSnapshot(part.id, preview.path)

  const registration = getMonacoPaneForPath(preview.path) ?? getActiveMonacoPane(focusedPane)
  const model = registration?.editor.getModel()
  if (!registration || !model) return

  const content = model.getValue()
  const range = findEditRange(model, content, preview.oldText)
  if (!range) return

  registration.runtime.decorations.set('ai-inline-edit', [
    {
      range,
      className: preview.oldText ? 'lucky-monaco-ai-preview' : 'lucky-monaco-ai-add',
      isWholeLine: !preview.oldText || range.endLineNumber > range.startLineNumber,
      hoverMessage: tGlobal('codeAgent.inlineEditPreview')
    }
  ])

  showInlineEditWidget(registration, range, preview.path, part.id)
  pending.set(part.id, {
    path: preview.path,
    toolId: part.id,
    range,
    previewText: preview.newText
  })
}

export function clearAgentToolEdit(toolId?: string): void {
  if (toolId) {
    const entry = pending.get(toolId)
    pending.delete(toolId)
    snapshots.delete(toolId)
    if (entry) clearPaneDecorations(entry.path)
    return
  }
  for (const entry of pending.values()) clearPaneDecorations(entry.path)
  pending.clear()
  snapshots.clear()
}

function clearPaneDecorations(path: string): void {
  const registration = getMonacoPaneForPath(path)
  registration?.runtime.decorations.clear('ai-inline-edit')
  registration?.runtime.widgets.removeOverlayWidget('lucky-ai-inline-edit')
}

async function ensureSnapshot(toolId: string, path: string): Promise<void> {
  if (snapshots.has(toolId)) return

  const project = useProjectStore()
  const relativePath = toWorkspaceRelativePath(path, project.activeProject?.rootPath)
  if (!relativePath) return

  const registration = getMonacoPaneForPath(path)
  const modelContent = registration?.editor.getModel()?.getValue()
  if (typeof modelContent === 'string') {
    snapshots.set(toolId, { path, relativePath, content: modelContent })
    return
  }

  try {
    const file = await unwrap<{ content: string }>(ipc.file.read(relativePath))
    snapshots.set(toolId, { path, relativePath, content: file.content })
  } catch {
    snapshots.set(toolId, { path, relativePath, content: '' })
  }
}

function findEditRange(
  model: Monaco.editor.ITextModel,
  content: string,
  oldText: string
): Monaco.IRange | null {
  if (oldText) {
    const index = content.indexOf(oldText)
    if (index === -1) return null
    const start = model.getPositionAt(index)
    const end = model.getPositionAt(index + oldText.length)
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    }
  }

  const selection = model.getValueLength() > 0
    ? model.getFullModelRange()
    : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  return selection
}

function showInlineEditWidget(
  registration: NonNullable<ReturnType<typeof getMonacoPaneForPath>>,
  range: Monaco.IRange,
  path: string,
  toolId: string
): void {
  const bar = document.createElement('div')
  bar.className = 'lucky-ai-inline-edit-bar'

  const keep = document.createElement('button')
  keep.type = 'button'
  keep.className = 'lucky-ai-inline-edit-btn keep'
  keep.textContent = tGlobal('codeAgent.changedFileKeep')
  keep.addEventListener('click', () => {
    clearAgentToolEdit(toolId)
  })

  const undo = document.createElement('button')
  undo.type = 'button'
  undo.className = 'lucky-ai-inline-edit-btn undo'
  undo.textContent = tGlobal('codeAgent.changedFileUndo')
  undo.addEventListener('click', () => {
    void revertAgentInlineEdit(path, toolId)
  })

  bar.append(keep, undo)

  const widget: Monaco.editor.IOverlayWidget = {
    getId: () => 'lucky-ai-inline-edit',
    getDomNode: () => bar,
    getPosition: () => ({
      preference: 2,
      position: {
        lineNumber: range.endLineNumber,
        column: Math.max(1, range.endColumn)
      }
    })
  }

  registration.runtime.widgets.removeOverlayWidget('lucky-ai-inline-edit')
  registration.runtime.widgets.addOverlayWidget(widget)
}

async function revertAgentInlineEdit(path: string, toolId: string): Promise<void> {
  const snapshot = snapshots.get(toolId)
  clearAgentToolEdit(toolId)

  const project = useProjectStore()
  const editor = useEditorStore()
  const relativePath = snapshot?.relativePath ?? toWorkspaceRelativePath(path, project.activeProject?.rootPath)
  if (!relativePath) return

  try {
    if (project.gitStatus.isRepository) {
      await unwrap(ipc.workspace.discardGitFile(relativePath, project.activeProject?.rootPath))
    } else if (snapshot) {
      await unwrap(ipc.file.write(relativePath, snapshot.content))
    } else {
      return
    }
    await editor.reloadFiles([relativePath]).catch(() => undefined)
  } catch (error) {
    logger.error('revert inline edit failed', {
      path,
      toolId,
      error
    })
  }
}
