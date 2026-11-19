import type * as Monaco from 'monaco-editor'
import { tGlobal } from '../i18n/index.js'
import type { AIInlineEditRequest } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import { ipc, unwrap } from './ipc-client.js'
import { getActiveMonacoPane, type EditorPaneId } from './monaco-runtime.registry.js'
import { useEditorStore } from '../stores/editor.store.js'

interface InlineEditPreviewSession {
  id: string
  pane: EditorPaneId
  tabPath: string
  instruction: string
  requestId?: string
  range: Monaco.IRange
  originalText: string
  replacement: string
  originalContent: string
  modifiedContent: string
}

let focusedPane: EditorPaneId = 'primary'
const composerWidgetId = 'lucky-ai-inline-edit-composer'
const previewWidgetId = 'lucky-ai-inline-edit-review'
let activeSession: InlineEditPreviewSession | null = null
let pendingRefine: { instruction: string; previousReplacement: string } | null = null

const logger = createLogger('renderer/manual-inline-edit')

export function setManualInlineEditFocusedPane(pane: EditorPaneId): void {
  focusedPane = pane
}

export function openManualInlineEditComposer(initialInstruction = ''): void {
  const registration = getActiveMonacoPane(focusedPane)
  const editor = registration?.editor
  const model = editor?.getModel()
  const tabPath = registration?.tabPath()
  if (!registration || !editor || !model || !tabPath) return

  const refineContext = pendingRefine
  pendingRefine = null
  clearManualInlineEditPreview()
  registration.runtime.widgets.removeOverlayWidget(composerWidgetId)

  const root = document.createElement('div')
  root.className = 'lucky-ai-inline-edit-composer'

  const title = document.createElement('div')
  title.className = 'lucky-ai-inline-edit-title'
  title.textContent = 'Inline Edit'

  const input = document.createElement('textarea')
  input.className = 'lucky-ai-inline-edit-input'
  input.placeholder = '描述你希望如何修改当前选择'
  input.value = initialInstruction

  const status = document.createElement('div')
  status.className = 'lucky-ai-inline-edit-status'
  let activeRequestId: string | null = null

  const actions = document.createElement('div')
  actions.className = 'lucky-ai-inline-edit-actions'

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'lucky-ai-inline-edit-btn'
  cancel.textContent = tGlobal('common.cancel')
  cancel.addEventListener('click', () => {
    if (activeRequestId) {
      void ipc.ai.cancelInline(activeRequestId).catch(() => undefined)
    }
    registration.runtime.widgets.removeOverlayWidget(composerWidgetId)
  })

  const generate = document.createElement('button')
  generate.type = 'button'
  generate.className = 'lucky-ai-inline-edit-btn keep'
  generate.textContent = '生成预览'
  generate.addEventListener('click', () => {
    const instruction = input.value.trim()
    if (!instruction) {
      status.textContent = '请输入修改指令'
      return
    }
    activeRequestId = globalThis.crypto.randomUUID()
    generate.disabled = true
    input.disabled = true
    status.textContent = '正在生成...'
    void generateManualInlineEdit(
      registration.pane,
      instruction,
      activeRequestId,
      refineContext?.previousReplacement
    ).then(() => {
      activeRequestId = null
      registration.runtime.widgets.removeOverlayWidget(composerWidgetId)
    }).catch((error) => {
      activeRequestId = null
      logger.warn('inline edit generation failed', { tabPath, error })
      status.textContent = error instanceof Error ? error.message : String(error)
      generate.disabled = false
      input.disabled = false
    })
  })

  actions.append(cancel, generate)
  root.append(title, input, status, actions)

  const widget: Monaco.editor.IOverlayWidget = {
    getId: () => composerWidgetId,
    getDomNode: () => root,
    getPosition: () => ({
      preference: 0
    })
  }

  registration.runtime.widgets.addOverlayWidget(widget)
  queueMicrotask(() => input.focus())
}

export function clearManualInlineEditPreview(): void {
  if (!activeSession) return
  const registration = getActiveMonacoPane(activeSession.pane)
  registration?.runtime.decorations.clear('manual-inline-edit')
  registration?.runtime.widgets.removeOverlayWidget(previewWidgetId)
  activeSession = null
}

async function generateManualInlineEdit(
  pane: EditorPaneId,
  instruction: string,
  requestId: string,
  previousReplacement?: string
): Promise<void> {
  const registration = getActiveMonacoPane(pane)
  const editor = registration?.editor
  const model = editor?.getModel()
  const tabPath = registration?.tabPath()
  if (!registration || !editor || !model || !tabPath) return

  const targetRange = resolveTargetRange(editor, model)
  const originalText = model.getValueInRange(targetRange)
  const content = model.getValue()
  const startOffset = model.getOffsetAt({
    lineNumber: targetRange.startLineNumber,
    column: targetRange.startColumn
  })
  const endOffset = model.getOffsetAt({
    lineNumber: targetRange.endLineNumber,
    column: targetRange.endColumn
  })
  const request: AIInlineEditRequest = {
    requestId,
    filePath: model.uri.fsPath,
    languageId: model.getLanguageId(),
    instruction,
    selectedText: originalText,
    beforeSelection: content.slice(Math.max(0, startOffset - 2500), startOffset),
    afterSelection: content.slice(endOffset, Math.min(content.length, endOffset + 2500)),
    previousReplacement
  }

  const result = await unwrap<{ requestId: string; replacement: string }>(ipc.ai.inlineEdit(request))
  const replacement = result.replacement ?? ''
  const modifiedContent = `${content.slice(0, startOffset)}${replacement}${content.slice(endOffset)}`

  registration.runtime.decorations.set('manual-inline-edit', [{
    range: targetRange,
    className: replacement.trim() ? 'lucky-monaco-ai-preview' : 'lucky-monaco-ai-remove',
    isWholeLine: targetRange.startLineNumber !== targetRange.endLineNumber,
    hoverMessage: 'AI Inline Edit Preview'
  }])

  activeSession = {
    id: globalThis.crypto.randomUUID(),
    pane,
    tabPath,
    instruction,
    requestId,
    range: targetRange,
    originalText,
    replacement,
    originalContent: content,
    modifiedContent
  }
  showPreviewWidget(registration, activeSession)
}

function showPreviewWidget(
  registration: NonNullable<ReturnType<typeof getActiveMonacoPane>>,
  session: InlineEditPreviewSession
): void {
  registration.runtime.widgets.removeOverlayWidget(previewWidgetId)

  const bar = document.createElement('div')
  bar.className = 'lucky-ai-inline-edit-bar'

  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'lucky-ai-inline-edit-btn keep'
  accept.textContent = tGlobal('editor.accept')
  accept.addEventListener('click', () => {
    applySessionToEditor(session)
  })

  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'lucky-ai-inline-edit-btn undo'
  reject.textContent = tGlobal('editor.reject')
  reject.addEventListener('click', () => {
    clearManualInlineEditPreview()
  })

  const review = document.createElement('button')
  review.type = 'button'
  review.className = 'lucky-ai-inline-edit-btn'
  review.textContent = '逐块审阅'
  review.addEventListener('click', () => {
    const editorStore = useEditorStore()
    editorStore.showDiffView(session.tabPath, session.originalContent, session.modifiedContent, {
      title: `${session.tabPath} · Inline Edit`,
      inline: true
    })
  })

  const refine = document.createElement('button')
  refine.type = 'button'
  refine.className = 'lucky-ai-inline-edit-btn'
  refine.textContent = tGlobal('common.continue')
  refine.addEventListener('click', () => {
    pendingRefine = {
      instruction: session.instruction,
      previousReplacement: session.replacement
    }
    clearManualInlineEditPreview()
    openManualInlineEditComposer(session.instruction)
  })

  bar.append(accept, reject, review, refine)

  const widget: Monaco.editor.IOverlayWidget = {
    getId: () => previewWidgetId,
    getDomNode: () => bar,
    getPosition: () => ({
      preference: 2,
      position: {
        lineNumber: session.range.endLineNumber,
        column: session.range.endColumn
      }
    })
  }

  registration.runtime.widgets.addOverlayWidget(widget)
}

function applySessionToEditor(session: InlineEditPreviewSession): void {
  const registration = getActiveMonacoPane(session.pane)
  const editor = registration?.editor
  const model = editor?.getModel()
  if (!registration || !editor || !model) return

  editor.executeEdits('lucky-inline-edit', [{
    range: session.range,
    text: session.replacement,
    forceMoveMarkers: true
  }])
  clearManualInlineEditPreview()
}

function resolveTargetRange(
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel
): Monaco.IRange {
  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) {
    return {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn
    }
  }

  const position = editor.getPosition() ?? { lineNumber: 1, column: 1 }
  const lineLength = model.getLineMaxColumn(position.lineNumber)
  return {
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: lineLength
  }
}
