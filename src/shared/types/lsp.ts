export type LspSeverity = 1 | 2 | 3 | 4

export interface LspDiagnostic {
  message: string
  severity: LspSeverity
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  source?: string
  code?: string | number
}

export interface LspDiagnosticsPayload {
  languageId: string
  path: string
  diagnostics: LspDiagnostic[]
}

export interface LspStartRequest {
  languageId: string
  workspaceRoot: string
}

export interface LspStartResult {
  languageId: string
  running: boolean
  serverCommand?: string
  error?: string
}

export interface LspDocumentSyncRequest {
  languageId: string
  path: string
  content: string
  version: number
  action: 'open' | 'change' | 'close'
}

export interface LspLanguageSupport {
  languageId: string
  status: 'idle' | 'starting' | 'running' | 'failed' | 'unavailable'
  error?: string
  serverCommand?: string
}

export interface LspPositionRequest {
  languageId: string
  path: string
  lineNumber: number
  column: number
}

export interface LspCodeActionRequest extends LspPositionRequest {
  endLineNumber?: number
  endColumn?: number
  diagnostics?: LspDiagnostic[]
}

export interface LspRangeRequest extends LspPositionRequest {
  endLineNumber: number
  endColumn: number
}

export interface LspRequestPayload {
  languageId: string
  method: string
  params?: unknown
}
