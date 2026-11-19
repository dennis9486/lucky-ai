import type * as Monaco from 'monaco-editor'
import { LSP_LANGUAGE_IDS } from '../../shared/lsp/constants.js'
import type { AIInlineCompletionRequest, AIInlineCompletionStats } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import { resolveEditorLanguage } from './monaco.service.js'
import { ipc } from './ipc-client.js'

let registered = false
const logger = createLogger('renderer/ai-completion')
const activeRequests = new Map<string, string>()
const latestSuggestionByModel = new Map<string, CompletionSuggestion>()
const suggestionByFingerprint = new Map<string, CompletionSuggestion>()
let stats: AIInlineCompletionStats = {
  requested: 0,
  shown: 0,
  accepted: 0,
  dismissed: 0,
  canceled: 0
}
let persistTimer: ReturnType<typeof setTimeout> | null = null
let hydrated = false

interface CompletionSuggestion {
  requestId: string
  modelUri: string
  insertText: string
  range: Monaco.IRange
  accepted: boolean
}

export function registerInlineCompletionProvider(
  monaco: typeof Monaco,
  enabled: () => boolean
): void {
  if (registered) return
  registered = true

  monaco.languages.registerInlineCompletionsProvider([...LSP_LANGUAGE_IDS], {
    provideInlineCompletions: async (model, position, context, token) => {
      if (!enabled() || token.isCancellationRequested) return { items: [] }

      const languageId = resolveEditorLanguage(model.uri.fsPath)
      if (!LSP_LANGUAGE_IDS.includes(languageId as typeof LSP_LANGUAGE_IDS[number])) {
        return { items: [] }
      }

      const request = buildCompletionRequest(model, position, languageId, context.triggerKind === 0 ? 'automatic' : 'explicit')
      incrementStat('requested')
      const requestId = request.requestId
      activeRequests.set(model.uri.toString(), requestId)

      const cancel = () => {
        activeRequests.delete(model.uri.toString())
        incrementStat('canceled')
        void ipc.ai.cancelInline(requestId).catch(() => undefined)
      }
      token.onCancellationRequested(cancel)

      let response
      try {
        response = await ipc.ai.inlineComplete(request)
      } catch (error) {
        logger.warn('inline completion invoke failed', { error, filePath: request.filePath })
        cancel()
        return { items: [] }
      }

      if (token.isCancellationRequested || activeRequests.get(model.uri.toString()) !== requestId) {
        cancel()
        return { items: [] }
      }
      activeRequests.delete(model.uri.toString())
      if (!response.success || !response.data?.insertText.trim()) {
        if (!response.success) logger.debug('inline completion returned error', { error: response.error })
        return { items: [] }
      }

      const items = normalizeInlineItems(monaco, model, position, response.data.insertText, requestId)
      if (items.length) incrementStat('shown')
      return { items, enableForwardStability: true }
    },
    freeInlineCompletions: (result) => {
      const items = ((result as unknown as { items?: readonly unknown[] }).items ?? [])
      for (const item of items) {
        const key = getSuggestionKey(item)
        const suggestion = suggestionByFingerprint.get(key)
        if (suggestion && !suggestion.accepted) {
          incrementStat('dismissed')
        }
        suggestionByFingerprint.delete(key)
      }
    }
  })
}

export function bindInlineCompletionEditor(
  editor: Monaco.editor.IStandaloneCodeEditor
): Monaco.IDisposable {
  const disposable = editor.onDidChangeModelContent((event) => {
    const model = editor.getModel()
    if (!model) return
    const key = model.uri.toString()
    const suggestion = latestSuggestionByModel.get(key)
    if (!suggestion || suggestion.accepted) return
    const accepted = event.changes.some((change) => isSuggestionAccepted(change.text, suggestion.insertText))
    if (!accepted) return

    suggestion.accepted = true
    latestSuggestionByModel.set(key, suggestion)
    suggestionByFingerprint.delete(getSuggestionKey(suggestion))
    incrementStat('accepted')
    stats.lastAcceptedAt = Date.now()
    schedulePersist()

    queueMicrotask(() => {
      editor.getAction('editor.action.inlineSuggest.trigger')?.run().catch(() => undefined)
    })
  })
  return {
    dispose() {
      disposable.dispose()
      const model = editor.getModel()
      if (model) latestSuggestionByModel.delete(model.uri.toString())
    }
  }
}

function isSuggestionAccepted(changeText: string, insertText: string): boolean {
  const normalizedChange = normalizeCompletionText(changeText)
  const normalizedInsert = normalizeCompletionText(insertText)
  if (!normalizedChange || !normalizedInsert) return false
  if (normalizedChange === normalizedInsert) return true
  return normalizedChange.length >= Math.min(12, normalizedInsert.length) && normalizedInsert.startsWith(normalizedChange)
}

function normalizeCompletionText(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd()
}

export function cancelInlineCompletionsForEditor(editor: Monaco.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel()
  if (!model) return
  const modelKey = model.uri.toString()
  const requestId = activeRequests.get(modelKey)
  if (!requestId) return
  activeRequests.delete(modelKey)
  latestSuggestionByModel.delete(modelKey)
  incrementStat('canceled')
  void ipc.ai.cancelInline(requestId).catch(() => undefined)
}

export function getInlineCompletionStats(): AIInlineCompletionStats {
  return { ...stats }
}

export function hydrateInlineCompletionStats(next?: Partial<AIInlineCompletionStats>): void {
  if (hydrated || !next) return
  hydrated = true
  stats = {
    requested: Number(next.requested ?? 0),
    shown: Number(next.shown ?? 0),
    accepted: Number(next.accepted ?? 0),
    dismissed: Number(next.dismissed ?? 0),
    canceled: Number(next.canceled ?? 0),
    lastAcceptedAt: next.lastAcceptedAt
  }
}

function normalizeInlineItems(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  insertText: string,
  requestId: string
): Monaco.languages.InlineCompletion[] {
  const word = model.getWordUntilPosition(position)
  const fallbackRange: Monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn
  }

  latestSuggestionByModel.set(model.uri.toString(), {
    requestId,
    modelUri: model.uri.toString(),
    insertText,
    range: fallbackRange,
    accepted: false
  })
  suggestionByFingerprint.set(getSuggestionKey({ range: fallbackRange, insertText }), latestSuggestionByModel.get(model.uri.toString())!)
  return [{ insertText, range: fallbackRange }]
}

function buildCompletionRequest(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  languageId: string,
  triggerKind: AIInlineCompletionRequest['triggerKind']
): AIInlineCompletionRequest {
  const offset = model.getOffsetAt(position)
  const content = model.getValue()
  const lineContent = model.getLineContent(position.lineNumber)
  const linePrefix = lineContent.slice(0, position.column - 1)
  const lineSuffix = lineContent.slice(position.column - 1)
  return {
    requestId: globalThis.crypto.randomUUID(),
    filePath: model.uri.fsPath,
    languageId,
    beforeCursor: content.slice(Math.max(0, offset - 6000), offset),
    afterCursor: content.slice(offset, Math.min(content.length, offset + 2500)),
    linePrefix,
    lineSuffix,
    triggerKind,
    maxLines: triggerKind === 'explicit' ? 20 : 12
  }
}

function getSuggestionKey(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const record = item as { range?: Monaco.IRange; insertText?: string }
  const range = record.range
  if (!range) return ''
  return [
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn,
    record.insertText ?? ''
  ].join(':')
}

function incrementStat(key: keyof AIInlineCompletionStats): void {
  if (key === 'lastAcceptedAt') return
  stats = {
    ...stats,
    [key]: (stats[key] as number) + 1
  }
  schedulePersist()
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void ipc.settings.set({
      editor: {
        aiInlineCompletionStats: stats
      }
    }).catch(() => undefined)
  }, 400)
}
