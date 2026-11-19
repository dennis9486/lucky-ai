import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type {
  LspDocumentSyncRequest,
  LspCodeActionRequest,
  LspPositionRequest,
  LspRequestPayload,
  LspStartRequest
} from '../../shared/types/lsp.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import { lspElapsed, lspError, lspLog, shortLspPath } from '../../shared/utils/lsp-log.js'
import { lspService } from '../services/lsp.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

async function handleLsp<T>(label: string, detail: Record<string, unknown>, fn: () => Promise<T>): Promise<IpcResult<T>> {
  const startedAt = Date.now()
  const quiet = label === 'documentChange'
  if (!quiet) lspLog('ipc', `→ ${label}`, detail)
  try {
    const data = await fn()
    if (!quiet) lspLog('ipc', `← ${label}`, { ...detail, ms: lspElapsed(startedAt), ok: true })
    return ok(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lspError('ipc', `← ${label} failed`, { ...detail, ms: lspElapsed(startedAt), error: message })
    return fail(message)
  }
}

export function registerLspIpc(getWindow: () => Electron.BrowserWindow | null): void {
  lspLog('ipc', 'register handlers')
  lspService.setSenderWindow(getWindow())

  ipcMain.handle(IPC_CHANNELS.LSP_START, async (_event, request: LspStartRequest) =>
    handleLsp('start', {
      languageId: request.languageId,
      workspaceRoot: shortLspPath(request.workspaceRoot)
    }, async () => {
      lspService.setSenderWindow(getWindow())
      return lspService.start(request)
    })
  )

  ipcMain.handle(IPC_CHANNELS.LSP_STOP, async (_event, languageId: string) =>
    handleLsp('stop', { languageId }, async () => {
      await lspService.stop(languageId)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.LSP_DOCUMENT_OPEN, async (_event, request: LspDocumentSyncRequest) =>
    handleLsp('documentOpen', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      version: request.version
    }, async () => {
      await lspService.syncDocument({ ...request, action: 'open' })
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.LSP_DOCUMENT_CHANGE, async (_event, request: LspDocumentSyncRequest) =>
    handleLsp('documentChange', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      version: request.version
    }, async () => {
      await lspService.syncDocument({ ...request, action: 'change' })
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.LSP_DOCUMENT_CLOSE, async (_event, request: LspDocumentSyncRequest) =>
    handleLsp('documentClose', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      version: request.version
    }, async () => {
      await lspService.syncDocument({ ...request, action: 'close' })
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.LSP_STATUS, async (_event, languageId: string) =>
    handleLsp('status', { languageId }, async () => lspService.getStatus(languageId))
  )

  ipcMain.handle(IPC_CHANNELS.LSP_HOVER, async (_event, request: LspPositionRequest) =>
    handleLsp('hover', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      line: request.lineNumber,
      column: request.column
    }, async () => lspService.hover(request))
  )

  ipcMain.handle(IPC_CHANNELS.LSP_DEFINITION, async (_event, request: LspPositionRequest) =>
    handleLsp('definition', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      line: request.lineNumber,
      column: request.column
    }, async () => lspService.definition(request))
  )

  ipcMain.handle(IPC_CHANNELS.LSP_CODE_ACTION, async (_event, request: LspCodeActionRequest) =>
    handleLsp('codeAction', {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      line: request.lineNumber,
      column: request.column
    }, async () => lspService.codeAction(request))
  )

  ipcMain.handle(IPC_CHANNELS.LSP_REQUEST, async (_event, request: LspRequestPayload) =>
    handleLsp('request', {
      languageId: request.languageId,
      method: request.method
    }, async () => lspService.lspRequest(request.languageId, request.method, request.params))
  )
}
