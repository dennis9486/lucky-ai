import type * as Monaco from 'monaco-editor'
import type { LspDiagnostic } from '../../shared/types/lsp.js'
import {
  LSP_LANGUAGE_IDS,
  LSP_SEMANTIC_TOKEN_MODIFIERS,
  LSP_SEMANTIC_TOKEN_TYPES
} from '../../shared/lsp/constants.js'
import { lspLog, shortLspPath } from '../../shared/utils/lsp-log.js'
import { tGlobal } from '../i18n/index.js'
import { resolveEditorLanguage } from './monaco.service.js'
import { applyWorkspaceEdit } from './workspace-edit.service.js'
import { bindDiagnosticsToMonaco, listDiagnostics, subscribeDiagnostics } from './lsp/lsp-diagnostics.js'
import {
  extractCompletionLabel,
  resolveCompletionInsertText,
  resolveCompletionRange
} from './lsp/lsp-completion.js'
import { lspRequest } from './lsp/lsp-request.js'
import { ipc } from './ipc-client.js'
import {
  ensureDocumentReadyForRequest,
  ensureLanguageClient,
  getLanguageClientForPath,
  getLanguageClientStatus,
  listLanguageClients,
  resolveLspPath,
  stopAllLanguageClients,
  subscribeLanguageClients,
  syncChangeDocument,
  syncCloseDocument,
  syncOpenDocument,
  toEditorTabPath
} from './lsp/lsp-session.js'

export type { LanguageClientStatus, RegisteredLanguageClient } from './lsp/lsp-session.js'
export {
  ensureLanguageClient,
  getLanguageClientForPath,
  getLanguageClientStatus,
  listDiagnostics,
  listLanguageClients,
  stopAllLanguageClients,
  subscribeDiagnostics,
  subscribeLanguageClients,
  syncChangeDocument,
  syncCloseDocument,
  syncOpenDocument
}

export interface LspCodeActionItem {
  title: string
  kind?: string
  disabled?: { reason?: string }
  raw?: unknown
}

let lspFeaturesRegistered = false
let lspCommandRegistered = false
let lspApplyEditBound = false
let monacoRef: typeof Monaco | null = null
const lspEditorActionsRegistered = new WeakSet<Monaco.editor.IStandaloneCodeEditor>()

type LspRecord = Record<string, unknown>
type CompletionItemWithLsp = Monaco.languages.CompletionItem & {
  lspData?: unknown
  lspLanguageId?: string
}

type CodeActionWithLsp = Monaco.languages.CodeAction & {
  lspRaw?: unknown
  lspLanguageId?: string
  lspFilePath?: string
}

const LSP_SELECTOR: Monaco.languages.LanguageSelector = [...LSP_LANGUAGE_IDS]
const LSP_EXECUTE_CODE_ACTION_COMMAND = 'lucky.lsp.executeCodeAction'

export function bindMonacoForLsp(monaco: typeof Monaco): void {
  monacoRef = monaco
  bindDiagnosticsToMonaco(monaco)
  registerLspCommandHandler(monaco)
  bindLspApplyEdit(monaco)
  lspLog('client', 'bind monaco for LSP')
}

function registerLspCommandHandler(monaco: typeof Monaco): void {
  if (lspCommandRegistered) return
  lspCommandRegistered = true
  monaco.editor.registerCommand(LSP_EXECUTE_CODE_ACTION_COMMAND, (
    _accessor,
    raw: unknown,
    filePath: string | undefined,
    languageId: string | undefined,
    shouldApplyEdit = false
  ) => {
    void executeLspCodeActionRaw(monaco, raw, filePath, languageId, undefined, shouldApplyEdit)
  })
}

function bindLspApplyEdit(monaco: typeof Monaco): void {
  if (lspApplyEditBound) return
  lspApplyEditBound = true
  ipc.lsp.onApplyEdit((payload: { languageId: string; edit: unknown }) => {
    const edit = normalizeWorkspaceEdit(monaco, payload.edit)
    if (!edit) return
    void import('../stores/project.store.js').then(({ useProjectStore }) => {
      const project = useProjectStore()
      return applyWorkspaceEdit(monaco, edit, project.activeProject?.rootPath)
    })
  })
}

export function registerMonacoLspFeatures(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor
): void {
  registerEditorLspActions(monaco, editor)
  if (lspFeaturesRegistered) return

  lspFeaturesRegistered = true
  lspLog('client', 'register monaco LSP providers')
  const selector = LSP_SELECTOR

  monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '#'],
    provideCompletionItems: async (model, position, context, token) => {
      const result = await safeLspRequest(model, 'textDocument/completion', {
        ...textDocumentPositionParams(model, position),
        context: {
          triggerKind: toLspCompletionTriggerKind(context.triggerKind),
          triggerCharacter: context.triggerCharacter
        }
      }, token)
      return normalizeCompletionList(monaco, model, position, result)
    },
    resolveCompletionItem: async (item) => {
      const data = (item as Monaco.languages.CompletionItem & { lspData?: unknown }).lspData
      if (!data) return item
      const resolved = await lspRequest(modelLanguageFromItem(item), 'completionItem/resolve', data)
      return normalizeCompletionItem(monaco, null, null, resolved, item) ?? item
    }
  })

  monaco.languages.registerHoverProvider(selector, {
    provideHover: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/hover', textDocumentPositionParams(model, position), token)
      return formatHover(monaco, result)
    }
  })

  monaco.languages.registerDefinitionProvider(selector, {
    provideDefinition: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/definition', textDocumentPositionParams(model, position), token)
      return normalizeDefinitions(monaco, result)
    }
  })

  monaco.languages.registerDeclarationProvider(selector, {
    provideDeclaration: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/declaration', textDocumentPositionParams(model, position), token)
      return normalizeDefinitions(monaco, result)
    }
  })

  monaco.languages.registerImplementationProvider(selector, {
    provideImplementation: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/implementation', textDocumentPositionParams(model, position), token)
      return normalizeDefinitions(monaco, result)
    }
  })

  monaco.languages.registerTypeDefinitionProvider(selector, {
    provideTypeDefinition: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/typeDefinition', textDocumentPositionParams(model, position), token)
      return normalizeDefinitions(monaco, result)
    }
  })

  monaco.languages.registerReferenceProvider(selector, {
    provideReferences: async (model, position, context, token) => {
      const result = await safeLspRequest(model, 'textDocument/references', {
        ...textDocumentPositionParams(model, position),
        context: { includeDeclaration: context.includeDeclaration }
      }, token)
      return normalizeLocations(monaco, result)
    }
  })

  monaco.languages.registerRenameProvider(selector, {
    provideRenameEdits: async (model, position, newName) => {
      const result = await safeLspRequest(model, 'textDocument/rename', {
        ...textDocumentPositionParams(model, position),
        newName
      })
      return normalizeWorkspaceEdit(monaco, result)
    },
    resolveRenameLocation: async (model, position) => {
      const result = await safeLspRequest(model, 'textDocument/prepareRename', textDocumentPositionParams(model, position))
      return normalizeRenameLocation(monaco, model, position, result)
    }
  })

  monaco.languages.registerDocumentSymbolProvider(selector, {
    displayName: 'LSP',
    provideDocumentSymbols: async (model) => {
      const result = await safeLspRequest(model, 'textDocument/documentSymbol', textDocumentParams(model))
      return normalizeDocumentSymbols(monaco, result)
    }
  })

  monaco.languages.registerDocumentHighlightProvider(selector, {
    provideDocumentHighlights: async (model, position, token) => {
      const result = await safeLspRequest(model, 'textDocument/documentHighlight', textDocumentPositionParams(model, position), token)
      return normalizeDocumentHighlights(monaco, result)
    }
  })

  monaco.languages.registerSelectionRangeProvider(selector, {
    provideSelectionRanges: async (model, positions) => {
      const result = await safeLspRequest(model, 'textDocument/selectionRange', {
        textDocument: textDocumentParams(model).textDocument,
        positions: positions.map(toLspPosition)
      })
      return normalizeSelectionRanges(result)
    }
  })

  monaco.languages.registerCodeActionProvider(selector, {
    provideCodeActions: async (model, range, context, token) => {
      const result = await safeLspRequest(model, 'textDocument/codeAction', {
        textDocument: textDocumentParams(model).textDocument,
        range: toLspRange(range),
        context: {
          diagnostics: context.markers.map(markerToLspDiagnostic),
          only: context.only
        }
      }, token)
      return {
        actions: normalizeCodeActions(monaco, result, model),
        dispose: () => undefined
      }
    },
    resolveCodeAction: async (codeAction) => {
      const action = codeAction as CodeActionWithLsp
      if (!action.lspRaw || !action.lspLanguageId) return codeAction
      const resolved = await lspRequest(action.lspLanguageId, 'codeAction/resolve', action.lspRaw)
      return normalizeCodeActionForMonaco(monaco, resolved, action.lspFilePath, action.lspLanguageId) ?? codeAction
    }
  }, {
    providedCodeActionKinds: [
      'quickfix',
      'refactor',
      'refactor.extract',
      'refactor.inline',
      'refactor.rewrite',
      'source',
      'source.fixAll',
      'source.organizeImports'
    ]
  })

  monaco.languages.registerDocumentFormattingEditProvider(selector, {
    displayName: 'LSP',
    provideDocumentFormattingEdits: async (model, options) => {
      const result = await safeLspRequest(model, 'textDocument/formatting', {
        textDocument: textDocumentParams(model).textDocument,
        options
      })
      return normalizeTextEdits(result)
    }
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
    displayName: 'LSP',
    provideDocumentRangeFormattingEdits: async (model, range, options) => {
      const result = await safeLspRequest(model, 'textDocument/rangeFormatting', {
        textDocument: textDocumentParams(model).textDocument,
        range: toLspRange(range),
        options
      })
      return normalizeTextEdits(result)
    }
  })

  monaco.languages.registerSignatureHelpProvider(selector, {
    signatureHelpTriggerCharacters: ['(', ',', '<'],
    signatureHelpRetriggerCharacters: [',', ')'],
    provideSignatureHelp: async (model, position, token, context) => {
      const result = await safeLspRequest(model, 'textDocument/signatureHelp', {
        ...textDocumentPositionParams(model, position),
        context: {
          triggerKind: context.triggerKind,
          triggerCharacter: context.triggerCharacter,
          isRetrigger: context.isRetrigger
        }
      }, token)
      return normalizeSignatureHelp(result)
    }
  })

  monaco.languages.registerInlayHintsProvider(selector, {
    displayName: 'LSP',
    provideInlayHints: async (model, range) => {
      const result = await safeLspRequest(model, 'textDocument/inlayHint', {
        textDocument: textDocumentParams(model).textDocument,
        range: toLspRange(range)
      })
      return {
        hints: normalizeInlayHints(monaco, result),
        dispose: () => undefined
      }
    },
    resolveInlayHint: async (hint) => hint
  })

  monaco.languages.registerFoldingRangeProvider(selector, {
    provideFoldingRanges: async (model) => {
      const result = await safeLspRequest(model, 'textDocument/foldingRange', textDocumentParams(model))
      return normalizeFoldingRanges(monaco, result)
    }
  })

  monaco.languages.registerLinkProvider(selector, {
    provideLinks: async (model) => {
      const result = await safeLspRequest(model, 'textDocument/documentLink', textDocumentParams(model))
      return {
        links: normalizeDocumentLinks(monaco, result),
        dispose: () => undefined
      }
    },
    resolveLink: async (link) => link
  })

  const semanticLegend: Monaco.languages.SemanticTokensLegend = {
    tokenTypes: [...LSP_SEMANTIC_TOKEN_TYPES],
    tokenModifiers: [...LSP_SEMANTIC_TOKEN_MODIFIERS]
  }
  monaco.languages.registerDocumentSemanticTokensProvider(selector, {
    getLegend: () => semanticLegend,
    provideDocumentSemanticTokens: async (model) => {
      const result = await safeLspRequest(model, 'textDocument/semanticTokens/full', textDocumentParams(model))
      return normalizeSemanticTokens(result)
    },
    releaseDocumentSemanticTokens: () => undefined
  })
  monaco.languages.registerDocumentRangeSemanticTokensProvider(selector, {
    getLegend: () => semanticLegend,
    provideDocumentRangeSemanticTokens: async (model, range) => {
      const result = await safeLspRequest(model, 'textDocument/semanticTokens/range', {
        textDocument: textDocumentParams(model).textDocument,
        range: toLspRange(range)
      })
      return normalizeSemanticTokens(result)
    }
  })

}

function registerEditorLspActions(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor
): void {
  if (lspEditorActionsRegistered.has(editor)) return
  lspEditorActionsRegistered.add(editor)

  // 悬停预览由 goToDefinitionAtPosition 提供；点击跳转走 LSP + editorStore（内置 DefinitionAction 在 Electron 下不可用）
  let modifierClickArmed = false

  editor.onMouseDown((event) => {
    const browserEvent = event.event.browserEvent as MouseEvent
    if (!(browserEvent.metaKey || browserEvent.ctrlKey)) {
      modifierClickArmed = false
      return
    }
    if (event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !event.target.position) {
      modifierClickArmed = false
      return
    }
    modifierClickArmed = true
  })

  editor.onMouseUp((event) => {
    if (!modifierClickArmed) return
    modifierClickArmed = false
    const browserEvent = event.event.browserEvent as MouseEvent
    if (!(browserEvent.metaKey || browserEvent.ctrlKey)) return
    if (event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !event.target.position) return
    void goToDefinitionAt(editor, event.target.position)
  })
}

export async function goToDefinitionAt(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position = editor.getPosition()
): Promise<boolean> {
  const monaco = monacoRef
  const model = editor.getModel()
  if (!monaco || !model || !position) return false

  const filePath = resolveLspPath(model.uri.fsPath || '')
  if (filePath) {
    const languageId = resolveEditorLanguage(filePath)
    const result = await lspRequest(languageId, 'textDocument/definition', {
      textDocument: { uri: monaco.Uri.file(filePath).toString() },
      position: {
        line: Math.max(0, position.lineNumber - 1),
        character: Math.max(0, position.column - 1)
      }
    })
    const locations = normalizeDefinitions(monaco, result)
    const list = Array.isArray(locations) ? locations : locations ? [locations] : []
    if (list.length > 0) {
      await revealDefinitionLocations(editor, locations)
      return true
    }
    lspLog('client', 'definition empty', {
      path: shortLspPath(filePath),
      line: position.lineNumber,
      column: position.column
    })
  }

  const builtInDefinition = editor.getAction('editor.action.revealDefinition')
  if (!builtInDefinition) {
    showEditorMessage(editor, position, tGlobal('editor.noDefinition'))
    return false
  }
  try {
    editor.setPosition(position)
    await builtInDefinition.run()
    return true
  } catch {
    showEditorMessage(editor, position, tGlobal('editor.noDefinition'))
    return false
  }
}

/** 在光标处弹出短暂提示（参考 VS Code 的“No definition found”），无依赖，容错。 */
function showEditorMessage(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position: Monaco.IPosition,
  message: string
): void {
  try {
    const controller = editor.getContribution('editor.contrib.messageController') as
      | { showMessage?: (message: string, position: Monaco.IPosition) => void }
      | null
    controller?.showMessage?.(message, position)
  } catch {
    // messageController 未加载时静默降级
  }
}

export function triggerEditorAction(
  editor: Monaco.editor.IStandaloneCodeEditor,
  actionId: string
): boolean {
  editor.focus()
  editor.trigger('editorContextMenu', actionId, null)
  return true
}

export async function fetchDefinitionLocations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position = editor.getPosition()
): Promise<Monaco.languages.Location[]> {
  const monaco = monacoRef
  const model = editor.getModel()
  if (!monaco || !model || !position) return []
  const result = await safeLspRequest(model, 'textDocument/definition', textDocumentPositionParams(model, position))
  const locations = normalizeDefinitions(monaco, result)
  return Array.isArray(locations) ? locations : locations ? [locations] : []
}

export async function fetchReferenceLocations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position = editor.getPosition(),
  includeDeclaration = true
): Promise<Monaco.languages.Location[]> {
  const monaco = monacoRef
  const model = editor.getModel()
  if (!monaco || !model || !position) return []
  const result = await safeLspRequest(model, 'textDocument/references', {
    ...textDocumentPositionParams(model, position),
    context: { includeDeclaration }
  })
  return normalizeLocations(monaco, result)
}

async function safeLspRequest(
  model: Monaco.editor.ITextModel,
  method: string,
  params: unknown,
  token?: Monaco.CancellationToken
): Promise<unknown> {
  // Monaco 在光标移动/快速输入时会取消旧请求；已取消则不发起，避免多余的 IPC/LSP 往返。
  if (token?.isCancellationRequested) return null
  const filePath = resolveLspPath(model.uri.fsPath || '')
  if (!filePath) return null
  const languageId = await ensureDocumentReadyForRequest(filePath, model.getValue())
  if (!languageId || token?.isCancellationRequested) return null
  const result = await lspRequest(languageId, method, params)
  // 请求返回后再次校验：已取消则丢弃陈旧结果，避免把过期的 hover/定义结果渲染出来。
  return token?.isCancellationRequested ? null : result
}

function textDocumentParams(model: Monaco.editor.ITextModel): { textDocument: { uri: string } } {
  const absPath = resolveLspPath(model.uri.fsPath || '')
  const monaco = monacoRef
  return {
    textDocument: {
      uri: monaco ? monaco.Uri.file(absPath).toString() : `file://${absPath}`
    }
  }
}

function textDocumentPositionParams(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): { textDocument: { uri: string }; position: { line: number; character: number } } {
  return {
    ...textDocumentParams(model),
    position: toLspPosition(position)
  }
}

function toLspPosition(position: Monaco.IPosition): { line: number; character: number } {
  return {
    line: Math.max(0, position.lineNumber - 1),
    character: Math.max(0, position.column - 1)
  }
}

function toLspRange(range: Monaco.IRange): {
  start: { line: number; character: number }
  end: { line: number; character: number }
} {
  return {
    start: { line: Math.max(0, range.startLineNumber - 1), character: Math.max(0, range.startColumn - 1) },
    end: { line: Math.max(0, range.endLineNumber - 1), character: Math.max(0, range.endColumn - 1) }
  }
}

function toLspCompletionTriggerKind(kind: Monaco.languages.CompletionTriggerKind): number {
  switch (kind) {
    case 1: return 2
    case 2: return 3
    default: return 1
  }
}

function modelLanguageFromItem(item: Monaco.languages.CompletionItem): string {
  return (item as CompletionItemWithLsp).lspLanguageId ?? ''
}

export async function requestCodeActions(filePath: string, diagnostic: LspDiagnostic): Promise<LspCodeActionItem[]> {
  const absPath = resolveLspPath(filePath)
  const languageId = resolveEditorLanguage(absPath)
  const response = await lspRequest(languageId, 'textDocument/codeAction', {
    textDocument: { uri: monacoRef ? monacoRef.Uri.file(absPath).toString() : absPath },
    range: {
      start: { line: diagnostic.startLineNumber - 1, character: diagnostic.startColumn - 1 },
      end: { line: diagnostic.endLineNumber - 1, character: diagnostic.endColumn - 1 }
    },
    context: { diagnostics: [diagnostic] }
  })

  if (!Array.isArray(response)) return []
  return response
    .map((item) => normalizeCodeAction(item))
    .filter((item): item is LspCodeActionItem => Boolean(item))
}

export async function applyCodeAction(
  filePath: string,
  action: LspCodeActionItem,
  workspaceRoot: string | null | undefined
): Promise<void> {
  if (!monacoRef || action.disabled) return
  await executeLspCodeActionRaw(monacoRef, action.raw, filePath, resolveEditorLanguage(resolveLspPath(filePath)), workspaceRoot)
}

async function executeLspCodeActionRaw(
  monaco: typeof Monaco,
  raw: unknown,
  filePath: string | undefined,
  languageId: string | undefined,
  workspaceRoot?: string | null,
  shouldApplyEdit = true
): Promise<void> {
  if (!raw || typeof raw !== 'object') return
  const record = raw as LspRecord
  if (shouldApplyEdit && record.edit) {
    const edit = normalizeWorkspaceEdit(monaco, record.edit)
    if (edit) await applyWorkspaceEdit(monaco, edit, workspaceRoot)
  }
  if (record.command && typeof record.command === 'object') {
    const command = record.command as LspRecord
    const title = typeof command.title === 'string' ? command.title : ''
    const commandId = typeof command.command === 'string' ? command.command : ''
    const resolvedFilePath = filePath ? resolveLspPath(filePath) : ''
    const resolvedLanguageId = languageId || (resolvedFilePath ? resolveEditorLanguage(resolvedFilePath) : '')
    if (commandId && resolvedLanguageId) {
      await lspRequest(resolvedLanguageId, 'workspace/executeCommand', {
        command: commandId,
        arguments: Array.isArray(command.arguments) ? command.arguments : []
      })
      lspLog('client', 'executed code action command', { title, commandId })
    }
  }
}

function normalizeCodeAction(item: unknown): LspCodeActionItem | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title : ''
  if (!title) return null
  const disabled = record.disabled && typeof record.disabled === 'object'
    ? { reason: typeof (record.disabled as Record<string, unknown>).reason === 'string'
        ? (record.disabled as Record<string, unknown>).reason as string
        : undefined }
    : undefined
  return {
    title,
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    disabled,
    raw: item
  }
}

function normalizeCompletionList(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  result: unknown
): Monaco.languages.CompletionList | null {
  if (result === null || result === undefined) return null
  const items = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as LspRecord).items)
      ? (result as { items: unknown[] }).items
      : []
  const suggestions = items
    .map((item) => normalizeCompletionItem(monaco, model, position, item))
    .filter((item): item is Monaco.languages.CompletionItem => Boolean(item))
    .filter(uniqueCompletionItem())
  return {
    suggestions,
    incomplete: Boolean(result && typeof result === 'object' && (result as LspRecord).isIncomplete)
  }
}

function uniqueCompletionItem(): (item: Monaco.languages.CompletionItem) => boolean {
  const seen = new Set<string>()
  return (item) => {
    const label = typeof item.label === 'string' ? item.label : item.label.label
    const detail = item.detail ?? ''
    const source = typeof item.label === 'object' ? item.label.detail ?? '' : ''
    const key = `${item.kind}:${label}:${detail}:${source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

function normalizeCompletionItem(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel | null,
  position: Monaco.Position | null,
  item: unknown,
  base?: Monaco.languages.CompletionItem
): Monaco.languages.CompletionItem | null {
  if (!item || typeof item !== 'object') return null
  const record = item as LspRecord
  const label = extractCompletionLabel(record.label) ?? (base?.label ? base.label : null)
  if (!label) return null
  const baseRange = base?.range
  const fallbackRange: Monaco.IRange = baseRange && 'startLineNumber' in baseRange
    ? baseRange
    : defaultCompletionRange(model, position)
  const range = resolveCompletionRange(record, toMonacoRange, fallbackRange)
  const insertText = resolveCompletionInsertText(record, label)
  const normalized: CompletionItemWithLsp = {
    ...(base ?? {}),
    label,
    kind: mapCompletionKind(monaco, Number(record.kind)),
    detail: typeof record.detail === 'string' ? record.detail : base?.detail,
    documentation: markdownValue(record.documentation) ?? base?.documentation,
    sortText: typeof record.sortText === 'string' ? record.sortText : base?.sortText,
    filterText: typeof record.filterText === 'string' ? record.filterText : base?.filterText,
    preselect: typeof record.preselect === 'boolean' ? record.preselect : base?.preselect,
    insertText,
    insertTextRules: record.insertTextFormat === 2
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : base?.insertTextRules,
    range,
    commitCharacters: Array.isArray(record.commitCharacters)
      ? record.commitCharacters.filter((value): value is string => typeof value === 'string')
      : base?.commitCharacters,
    additionalTextEdits: normalizeSingleTextEdits(record.additionalTextEdits) ?? base?.additionalTextEdits,
    lspData: record.data !== undefined ? item : base ? (base as CompletionItemWithLsp).lspData : undefined,
    lspLanguageId: model?.uri.fsPath ? resolveEditorLanguage(model.uri.fsPath) : (base as CompletionItemWithLsp | undefined)?.lspLanguageId
  }
  return normalized
}

function defaultCompletionRange(
  model: Monaco.editor.ITextModel | null,
  position: Monaco.Position | null
): Monaco.IRange {
  if (!model || !position) return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn
  }
}

function mapCompletionKind(monaco: typeof Monaco, value: number): Monaco.languages.CompletionItemKind {
  const map: Monaco.languages.CompletionItemKind[] = [
    monaco.languages.CompletionItemKind.Text,
    monaco.languages.CompletionItemKind.Method,
    monaco.languages.CompletionItemKind.Function,
    monaco.languages.CompletionItemKind.Constructor,
    monaco.languages.CompletionItemKind.Field,
    monaco.languages.CompletionItemKind.Variable,
    monaco.languages.CompletionItemKind.Class,
    monaco.languages.CompletionItemKind.Interface,
    monaco.languages.CompletionItemKind.Module,
    monaco.languages.CompletionItemKind.Property,
    monaco.languages.CompletionItemKind.Unit,
    monaco.languages.CompletionItemKind.Value,
    monaco.languages.CompletionItemKind.Enum,
    monaco.languages.CompletionItemKind.Keyword,
    monaco.languages.CompletionItemKind.Snippet,
    monaco.languages.CompletionItemKind.Color,
    monaco.languages.CompletionItemKind.File,
    monaco.languages.CompletionItemKind.Reference,
    monaco.languages.CompletionItemKind.Folder,
    monaco.languages.CompletionItemKind.EnumMember,
    monaco.languages.CompletionItemKind.Constant,
    monaco.languages.CompletionItemKind.Struct,
    monaco.languages.CompletionItemKind.Event,
    monaco.languages.CompletionItemKind.Operator,
    monaco.languages.CompletionItemKind.TypeParameter
  ]
  return map[Math.max(0, value - 1)] ?? monaco.languages.CompletionItemKind.Text
}

function formatHover(monaco: typeof Monaco, result: unknown): Monaco.languages.Hover | null {
  if (!result || typeof result !== 'object') return null
  const record = result as Record<string, unknown>
  const contents = record.contents
  if (typeof contents === 'string' && contents.trim()) {
    return { contents: [{ value: contents }] }
  }
  if (Array.isArray(contents)) {
    const seen = new Set<string>()
    const values = contents
      .map((item) => formatHoverContent(item))
      .filter((value): value is string => Boolean(value))
      .filter((value) => {
        if (seen.has(value)) return false
        seen.add(value)
        return true
      })
    if (!values.length) return null
    return { contents: values.map((value) => ({ value })) }
  }
  if (contents && typeof contents === 'object') {
    const value = formatHoverContent(contents)
    return value ? { contents: [{ value }] } : null
  }
  return null
}

function formatHoverContent(item: unknown): string | null {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  // LSP MarkedString `{ language, value }`：包成带语言标记的代码块，让类型签名/声明获得语法高亮，
  // 而不是渲染成一坨纯文本。必须在纯 value 分支之前判断。
  if (typeof record.value === 'string' && typeof record.language === 'string' && record.language.trim()) {
    return `\`\`\`${record.language}\n${record.value}\n\`\`\``
  }
  // MarkupContent `{ kind, value }` 或普通 `{ value }`
  if (typeof record.value === 'string') return record.value
  return null
}

function normalizeDefinitions(
  monaco: typeof Monaco,
  result: unknown
): Monaco.languages.Location | Monaco.languages.Location[] | null {
  if (!result) return null
  const items = Array.isArray(result) ? result : [result]
  const locations = items
    .map((item) => toMonacoLocation(monaco, item))
    .filter((item): item is Monaco.languages.Location => Boolean(item))
  if (!locations.length) return null
  return locations.length === 1 ? (locations[0] ?? null) : locations
}

function normalizeLocations(monaco: typeof Monaco, result: unknown): Monaco.languages.Location[] {
  const items = Array.isArray(result) ? result : result ? [result] : []
  return items
    .map((item) => toMonacoLocation(monaco, item))
    .filter((item): item is Monaco.languages.Location => Boolean(item))
}

function toMonacoLocation(monaco: typeof Monaco, item: unknown): Monaco.languages.Location | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const range = record.range && typeof record.range === 'object'
    ? toMonacoRange(record.range as Record<string, unknown>)
    : null
  const targetRange = record.targetRange && typeof record.targetRange === 'object'
    ? toMonacoRange(record.targetRange as Record<string, unknown>)
    : range
  const targetSelectionRange = record.targetSelectionRange && typeof record.targetSelectionRange === 'object'
    ? toMonacoRange(record.targetSelectionRange as Record<string, unknown>)
    : undefined
  const uriValue = typeof record.uri === 'string'
    ? record.uri
    : typeof record.targetUri === 'string'
      ? record.targetUri
      : null
  if (!targetRange || !uriValue) return null
  const originSelectionRange = record.originSelectionRange && typeof record.originSelectionRange === 'object'
    ? toMonacoRange(record.originSelectionRange as Record<string, unknown>) ?? undefined
    : undefined
  return {
    uri: monaco.Uri.parse(uriValue),
    range: targetRange,
    ...(originSelectionRange ? { originSelectionRange } : {}),
    ...(targetSelectionRange ? { targetSelectionRange } : {})
  } as Monaco.languages.Location
}

function normalizeRenameLocation(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  result: unknown
): Monaco.languages.RenameLocation | null {
  if (!result || typeof result !== 'object') {
    const word = model.getWordAtPosition(position)
    if (!word) return null
    return {
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      },
      text: word.word
    }
  }
  const record = result as LspRecord
  if (typeof record.placeholder === 'string' && record.range && typeof record.range === 'object') {
    const range = toMonacoRange(record.range as LspRecord)
    return range ? { range, text: record.placeholder } : null
  }
  const range = toMonacoRange(record)
  if (!range) return null
  return { range, text: model.getValueInRange(range) }
}

function normalizeDocumentSymbols(monaco: typeof Monaco, result: unknown): Monaco.languages.DocumentSymbol[] {
  if (!Array.isArray(result)) return []
  return result
    .map((item) => normalizeDocumentSymbol(monaco, item))
    .filter((item): item is Monaco.languages.DocumentSymbol => Boolean(item))
}

function normalizeDocumentSymbol(monaco: typeof Monaco, item: unknown): Monaco.languages.DocumentSymbol | null {
  if (!item || typeof item !== 'object') return null
  const record = item as LspRecord
  const name = typeof record.name === 'string' ? record.name : ''
  const range = record.range && typeof record.range === 'object'
    ? toMonacoRange(record.range as LspRecord)
    : null
  const selectionRange = record.selectionRange && typeof record.selectionRange === 'object'
    ? toMonacoRange(record.selectionRange as LspRecord)
    : range
  if (!name || !range || !selectionRange) return null
  return {
    name,
    detail: typeof record.detail === 'string' ? record.detail : '',
    kind: mapSymbolKind(monaco, Number(record.kind)),
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is Monaco.languages.SymbolTag => tag === 1) : [],
    containerName: typeof record.containerName === 'string' ? record.containerName : undefined,
    range,
    selectionRange,
    children: normalizeDocumentSymbols(monaco, record.children)
  }
}

function normalizeDocumentHighlights(monaco: typeof Monaco, result: unknown): Monaco.languages.DocumentHighlight[] {
  if (!Array.isArray(result)) return []
  const highlights: Monaco.languages.DocumentHighlight[] = []
  for (const item of result) {
    if (!item || typeof item !== 'object') continue
    const record = item as LspRecord
    const range = record.range && typeof record.range === 'object'
      ? toMonacoRange(record.range as LspRecord)
      : null
    if (!range) continue
    highlights.push({
      range,
      kind: mapDocumentHighlightKind(monaco, Number(record.kind))
    })
  }
  return highlights
}

function mapDocumentHighlightKind(monaco: typeof Monaco, value: number): Monaco.languages.DocumentHighlightKind {
  if (value === 2) return monaco.languages.DocumentHighlightKind.Read
  if (value === 3) return monaco.languages.DocumentHighlightKind.Write
  return monaco.languages.DocumentHighlightKind.Text
}

function normalizeSelectionRanges(result: unknown): Monaco.languages.SelectionRange[][] {
  if (!Array.isArray(result)) return []
  return result.map((item) => normalizeSelectionRangeChain(item)).filter((chain) => chain.length > 0)
}

function normalizeSelectionRangeChain(item: unknown): Monaco.languages.SelectionRange[] {
  const chain: Monaco.languages.SelectionRange[] = []
  let current = item
  while (current && typeof current === 'object') {
    const record = current as LspRecord
    const range = record.range && typeof record.range === 'object'
      ? toMonacoRange(record.range as LspRecord)
      : null
    if (!range) break
    chain.push({ range })
    current = record.parent
  }
  return chain
}

function mapSymbolKind(monaco: typeof Monaco, value: number): Monaco.languages.SymbolKind {
  const normalized = Number.isFinite(value) ? Math.max(0, value - 1) : monaco.languages.SymbolKind.Variable
  return normalized in monaco.languages.SymbolKind
    ? normalized as Monaco.languages.SymbolKind
    : monaco.languages.SymbolKind.Variable
}

function normalizeCodeActions(
  monaco: typeof Monaco,
  result: unknown,
  model: Monaco.editor.ITextModel
): Monaco.languages.CodeAction[] {
  if (!Array.isArray(result)) return []
  const filePath = resolveLspPath(model.uri.fsPath || '')
  const languageId = resolveEditorLanguage(filePath)
  return result
    .map((item) => normalizeCodeActionForMonaco(monaco, item, filePath, languageId))
    .filter((item): item is Monaco.languages.CodeAction => Boolean(item))
}

function normalizeCodeActionForMonaco(
  monaco: typeof Monaco,
  item: unknown,
  filePath?: string,
  languageId?: string
): Monaco.languages.CodeAction | null {
  if (!item || typeof item !== 'object') return null
  const record = item as LspRecord
  const title = typeof record.title === 'string' ? record.title : ''
  if (!title) return null
  const disabledReason = record.disabled && typeof record.disabled === 'object'
    ? (record.disabled as LspRecord).reason
    : undefined
  const normalized: CodeActionWithLsp = {
    title,
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    edit: normalizeWorkspaceEdit(monaco, record.edit) ?? undefined,
    diagnostics: [],
    isPreferred: typeof record.isPreferred === 'boolean' ? record.isPreferred : undefined,
    disabled: typeof disabledReason === 'string' ? disabledReason : undefined,
    command: record.command && typeof record.command === 'object'
      ? {
          id: LSP_EXECUTE_CODE_ACTION_COMMAND,
          title,
          arguments: [item, filePath, languageId, false]
        }
      : undefined,
    lspRaw: item,
    lspLanguageId: languageId,
    lspFilePath: filePath
  }
  return normalized
}

function normalizeWorkspaceEdit(monaco: typeof Monaco, result: unknown): Monaco.languages.WorkspaceEdit | null {
  if (!result || typeof result !== 'object') return null
  const record = result as LspRecord
  const edits: Monaco.languages.WorkspaceEdit['edits'] = []

  if (record.changes && typeof record.changes === 'object') {
    for (const [uri, value] of Object.entries(record.changes as Record<string, unknown>)) {
      for (const edit of normalizeTextEdits(value)) {
        edits.push({
          resource: monaco.Uri.parse(uri),
          versionId: undefined,
          textEdit: edit
        })
      }
    }
  }

  if (Array.isArray(record.documentChanges)) {
    for (const change of record.documentChanges) {
      if (!change || typeof change !== 'object') continue
      const changeRecord = change as LspRecord
      const uri = changeRecord.textDocument && typeof changeRecord.textDocument === 'object'
        ? (changeRecord.textDocument as LspRecord).uri
        : undefined
      if (typeof uri !== 'string') continue
      for (const edit of normalizeTextEdits(changeRecord.edits)) {
        edits.push({
          resource: monaco.Uri.parse(uri),
          versionId: undefined,
          textEdit: edit
        })
      }
    }
  }

  return edits.length ? { edits } : null
}

function toMonacoRange(raw: Record<string, unknown>): Monaco.IRange | null {
  const start = raw.start && typeof raw.start === 'object'
    ? raw.start as Record<string, unknown>
    : null
  const end = raw.end && typeof raw.end === 'object'
    ? raw.end as Record<string, unknown>
    : null
  if (!start || !end) return null
  const startLineNumber = Number(start.line ?? 0) + 1
  const startColumn = Number(start.character ?? 0) + 1
  const endLineNumber = Number(end.line ?? 0) + 1
  const endColumn = Number(end.character ?? 0) + 1
  if (!Number.isFinite(startLineNumber) || !Number.isFinite(startColumn)) return null
  return { startLineNumber, startColumn, endLineNumber, endColumn }
}

function normalizeTextEdits(result: unknown): Monaco.languages.TextEdit[] {
  if (!Array.isArray(result)) return []
  return result
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as LspRecord
      const range = record.range && typeof record.range === 'object'
        ? toMonacoRange(record.range as LspRecord)
        : null
      const text = typeof record.newText === 'string' ? record.newText : undefined
      return range && text !== undefined ? { range, text } : null
    })
    .filter((item): item is Monaco.languages.TextEdit => Boolean(item))
}

function normalizeSingleTextEdits(result: unknown): Monaco.editor.ISingleEditOperation[] | undefined {
  const edits = normalizeTextEdits(result).map((edit) => ({ range: edit.range, text: edit.text }))
  return edits.length ? edits : undefined
}

function normalizeSignatureHelp(result: unknown): Monaco.languages.SignatureHelpResult | null {
  if (!result || typeof result !== 'object') return null
  const record = result as LspRecord
  if (!Array.isArray(record.signatures)) return null
  const signatures: Monaco.languages.SignatureInformation[] = []
  for (const item of record.signatures) {
    if (!item || typeof item !== 'object') continue
    const sig = item as LspRecord
    const label = typeof sig.label === 'string' ? sig.label : ''
    if (!label) continue
    const parameters: Monaco.languages.ParameterInformation[] = []
    if (Array.isArray(sig.parameters)) {
      for (const param of sig.parameters) {
        const normalized = normalizeParameterInfo(param)
        if (normalized) parameters.push(normalized)
      }
    }
    signatures.push({
      label,
      documentation: markdownValue(sig.documentation) ?? undefined,
      parameters,
      activeParameter: typeof sig.activeParameter === 'number' ? sig.activeParameter : undefined
    })
  }
  if (!signatures.length) return null
  return {
    value: {
      signatures,
      activeSignature: typeof record.activeSignature === 'number' ? record.activeSignature : 0,
      activeParameter: typeof record.activeParameter === 'number' ? record.activeParameter : 0
    },
    dispose: () => undefined
  }
}

function normalizeParameterInfo(item: unknown): Monaco.languages.ParameterInformation | null {
  if (!item || typeof item !== 'object') return null
  const record = item as LspRecord
  if (typeof record.label !== 'string' && !Array.isArray(record.label)) return null
  return {
    label: record.label as string | [number, number],
    documentation: markdownValue(record.documentation) ?? undefined
  }
}

function normalizeInlayHints(monaco: typeof Monaco, result: unknown): Monaco.languages.InlayHint[] {
  if (!Array.isArray(result)) return []
  const hints: Monaco.languages.InlayHint[] = []
  for (const item of result) {
    if (!item || typeof item !== 'object') continue
    const record = item as LspRecord
    const position = record.position && typeof record.position === 'object'
      ? toMonacoPosition(record.position as LspRecord)
      : null
    if (!position) continue
    hints.push({
      label: normalizeInlayLabel(monaco, record.label),
      tooltip: markdownValue(record.tooltip) ?? undefined,
      position,
      kind: record.kind === 2 ? monaco.languages.InlayHintKind.Parameter : monaco.languages.InlayHintKind.Type,
      paddingLeft: typeof record.paddingLeft === 'boolean' ? record.paddingLeft : undefined,
      paddingRight: typeof record.paddingRight === 'boolean' ? record.paddingRight : undefined,
      textEdits: normalizeTextEdits(record.textEdits)
    })
  }
  return hints
}

function normalizeInlayLabel(monaco: typeof Monaco, value: unknown): string | Monaco.languages.InlayHintLabelPart[] {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: Monaco.languages.InlayHintLabelPart[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push({ label: item })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as LspRecord
    if (typeof record.value !== 'string') continue
    const location = toMonacoLocation(monaco, record.location)
    parts.push({
      label: record.value,
      tooltip: markdownValue(record.tooltip) ?? undefined,
      location: location ?? undefined
    })
  }
  return parts
}

function normalizeFoldingRanges(monaco: typeof Monaco, result: unknown): Monaco.languages.FoldingRange[] {
  if (!Array.isArray(result)) return []
  const ranges: Monaco.languages.FoldingRange[] = []
  for (const item of result) {
    if (!item || typeof item !== 'object') continue
    const record = item as LspRecord
    const start = Number(record.startLine)
    const end = Number(record.endLine)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    ranges.push({
      start: start + 1,
      end: end + 1,
      kind: typeof record.kind === 'string' ? monaco.languages.FoldingRangeKind.fromValue(record.kind) : undefined
    })
  }
  return ranges
}

function normalizeDocumentLinks(monaco: typeof Monaco, result: unknown): Monaco.languages.ILink[] {
  if (!Array.isArray(result)) return []
  const links: Monaco.languages.ILink[] = []
  for (const item of result) {
    if (!item || typeof item !== 'object') continue
    const record = item as LspRecord
    const range = record.range && typeof record.range === 'object'
      ? toMonacoRange(record.range as LspRecord)
      : null
    if (!range) continue
    links.push({
      range,
      url: typeof record.target === 'string' ? monaco.Uri.parse(record.target) : undefined,
      tooltip: typeof record.tooltip === 'string' ? record.tooltip : undefined
    })
  }
  return links
}

function normalizeSemanticTokens(result: unknown): Monaco.languages.SemanticTokens | null {
  if (!result || typeof result !== 'object') return null
  const record = result as LspRecord
  if (!Array.isArray(record.data)) return null
  return {
    resultId: typeof record.resultId === 'string' ? record.resultId : undefined,
    data: Uint32Array.from(record.data.map((value) => Number(value) || 0))
  }
}

function toMonacoPosition(raw: LspRecord): Monaco.IPosition | null {
  const line = Number(raw.line)
  const character = Number(raw.character)
  if (!Number.isFinite(line) || !Number.isFinite(character)) return null
  return { lineNumber: line + 1, column: character + 1 }
}

function markdownValue(value: unknown): string | Monaco.IMarkdownString | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const record = value as LspRecord
  if (typeof record.value === 'string') return { value: record.value }
  return undefined
}

function markerToLspDiagnostic(marker: Monaco.editor.IMarkerData): {
  range: ReturnType<typeof toLspRange>
  message: string
  severity: number
  source?: string
  code?: string
} {
  return {
    range: toLspRange(marker),
    message: marker.message,
    severity: marker.severity,
    source: marker.source,
    code: marker.code ? String(marker.code) : undefined
  }
}

async function revealDefinitionLocations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  locations: Monaco.languages.Location | Monaco.languages.Location[] | null
): Promise<void> {
  if (!locations) return
  const list = Array.isArray(locations) ? locations : [locations]
  const target = list[0]
  if (!target) return

  const targetPath = resolveLspPath(target.uri.fsPath)
  const tabPath = toEditorTabPath(targetPath)
  const currentPath = resolveLspPath(editor.getModel()?.uri.fsPath ?? '')

  if (currentPath === targetPath) {
    editor.setSelection(target.range)
    editor.revealRangeInCenter(target.range)
    editor.focus()
    return
  }

  const { useEditorStore } = await import('../stores/editor.store.js')
  const editorStore = useEditorStore()
  await editorStore.openFile(tabPath, {
    lineNumber: target.range.startLineNumber,
    column: target.range.startColumn,
    endColumn: target.range.endColumn
  })
}
