import type * as Monaco from 'monaco-editor'
import type { LspDiagnostic, LspDiagnosticsPayload } from '../../../shared/types/lsp.js'
import { lspLog, lspWarn, shortLspPath } from '../../../shared/utils/lsp-log.js'
import { resolveWorkspaceFilePath, toWorkspaceRelativePath } from '../../../shared/utils/workspace-path.js'
import { ipc } from '../ipc-client.js'
import { useProjectStore } from '../../stores/project.store.js'

const diagnosticsByPath = new Map<string, LspDiagnosticsPayload>()
const diagnosticsSubscribers = new Set<(payloads: LspDiagnosticsPayload[]) => void>()
let diagnosticsListenerBound = false
let monacoRef: typeof Monaco | null = null

function workspaceRoot(): string {
  return useProjectStore().activeProject?.rootPath ?? ''
}

function normalizeDiagnosticPath(path: string): string {
  return toWorkspaceRelativePath(path, workspaceRoot()) || path
}

export function bindDiagnosticsToMonaco(monaco: typeof Monaco): void {
  monacoRef = monaco
  if (diagnosticsListenerBound) return
  diagnosticsListenerBound = true
  lspLog('client', 'bind diagnostics listener')
  ipc.lsp.onDiagnostics(applyDiagnostics)
}

export function clearAllDiagnostics(): void {
  diagnosticsByPath.clear()
  notifyDiagnosticsSubscribers()
  const monaco = monacoRef
  if (!monaco) return
  for (const model of monaco.editor.getModels()) {
    monaco.editor.setModelMarkers(model, 'lucky-lsp', [])
  }
}

export function listDiagnostics(): LspDiagnosticsPayload[] {
  return [...diagnosticsByPath.values()].filter((payload) => payload.diagnostics.length > 0)
}

export function subscribeDiagnostics(callback: (payloads: LspDiagnosticsPayload[]) => void): () => void {
  diagnosticsSubscribers.add(callback)
  callback(listDiagnostics())
  return () => diagnosticsSubscribers.delete(callback)
}

function notifyDiagnosticsSubscribers(): void {
  const snapshot = listDiagnostics()
  for (const subscriber of diagnosticsSubscribers) subscriber(snapshot)
}

function applyDiagnostics(payload: LspDiagnosticsPayload): void {
  const tabPath = normalizeDiagnosticPath(payload.path)
  const normalized: LspDiagnosticsPayload = { ...payload, path: tabPath }

  if (!payload.diagnostics.length) {
    diagnosticsByPath.delete(tabPath)
  } else {
    diagnosticsByPath.set(tabPath, normalized)
  }
  notifyDiagnosticsSubscribers()

  const monaco = monacoRef
  if (!monaco) return

  const absPath = resolveWorkspaceFilePath(tabPath, workspaceRoot())
  const model = monaco.editor.getModel(monaco.Uri.file(absPath))
  if (!model) {
    lspWarn('client', 'diagnostics skipped: model not open', { path: shortLspPath(tabPath) })
    return
  }

  monaco.editor.setModelMarkers(
    model,
    'lucky-lsp',
    normalized.diagnostics.map((item) => ({
      message: item.message,
      severity: mapSeverity(monaco, item.severity),
      startLineNumber: item.startLineNumber,
      startColumn: item.startColumn,
      endLineNumber: item.endLineNumber,
      endColumn: item.endColumn,
      source: item.source,
      code: item.code ? String(item.code) : undefined
    }))
  )

  lspLog('client', 'apply diagnostics', {
    path: shortLspPath(tabPath),
    count: normalized.diagnostics.length
  })
}

function mapSeverity(monaco: typeof Monaco, severity: number): Monaco.MarkerSeverity {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error
    case 2: return monaco.MarkerSeverity.Warning
    case 3: return monaco.MarkerSeverity.Info
    case 4: return monaco.MarkerSeverity.Hint
    default: return monaco.MarkerSeverity.Warning
  }
}

export type { LspDiagnostic }
