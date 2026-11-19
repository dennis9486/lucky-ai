import type {
  LspDocumentSyncRequest,
  LspLanguageSupport,
  LspStartRequest,
  LspStartResult
} from '../../../shared/types/lsp.js'
import { isLspLanguageId, LSP_SYNC_DEBOUNCE_MS } from '../../../shared/lsp/constants.js'
import { lspElapsed, lspLog, lspWarn, shortLspPath } from '../../../shared/utils/lsp-log.js'
import { resolveWorkspaceFilePath } from '../../../shared/utils/workspace-path.js'
import { ipc, unwrap } from '../ipc-client.js'
import { resolveEditorLanguage } from '../monaco.service.js'
import { useProjectStore } from '../../stores/project.store.js'
import { clearAllDiagnostics } from './lsp-diagnostics.js'

export type LanguageClientStatus = LspLanguageSupport['status']

export interface RegisteredLanguageClient {
  languageId: string
  status: LanguageClientStatus
  error?: string
  serverCommand?: string
}

const statuses = new Map<string, RegisteredLanguageClient>()
const documentVersions = new Map<string, number>()
const openedDocuments = new Set<string>()
const lastSyncedContent = new Map<string, string>()
const changeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const languageClientSubscribers = new Set<(clients: RegisteredLanguageClient[]) => void>()

function workspaceRoot(): string {
  return useProjectStore().activeProject?.rootPath ?? ''
}

export function resolveLspPath(filePath: string): string {
  return resolveWorkspaceFilePath(filePath, workspaceRoot())
}

export function toEditorTabPath(absPath: string): string {
  const root = workspaceRoot().replace(/\\/g, '/').replace(/\/$/, '')
  const normalized = absPath.replace(/\\/g, '/')
  if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
    return normalized === root ? '' : normalized.slice(root.length + 1)
  }
  return normalized
}

export async function ensureLanguageClient(
  filePath: string,
  rootPath: string
): Promise<RegisteredLanguageClient> {
  const languageId = resolveEditorLanguage(filePath)
  if (!isLspLanguageId(languageId)) {
    return { languageId, status: 'unavailable' }
  }

  const cached = statuses.get(languageId)
  if (cached?.status === 'running') return cached

  statuses.set(languageId, { languageId, status: 'starting' })
  notifyLanguageClients()

  const startedAt = Date.now()
  const result = await unwrap<LspStartResult>(
    ipc.lsp.start({ languageId, workspaceRoot: rootPath } satisfies LspStartRequest)
  )

  const next: RegisteredLanguageClient = {
    languageId,
    status: result.running ? 'running' : result.serverCommand ? 'failed' : 'unavailable',
    error: result.error,
    serverCommand: result.serverCommand
  }
  statuses.set(languageId, next)
  notifyLanguageClients()

  if (next.status === 'running') {
    lspLog('client', 'language server running', { languageId, ms: lspElapsed(startedAt) })
  } else {
    lspWarn('client', 'language server unavailable', { languageId, status: next.status, error: next.error })
  }
  return next
}

export async function stopAllLanguageClients(): Promise<void> {
  for (const client of [...statuses.values()]) {
    if (client.status === 'running' || client.status === 'starting') {
      await unwrap(ipc.lsp.stop(client.languageId)).catch(() => undefined)
    }
  }
  for (const timer of changeTimers.values()) clearTimeout(timer)
  changeTimers.clear()
  statuses.clear()
  documentVersions.clear()
  openedDocuments.clear()
  lastSyncedContent.clear()
  clearAllDiagnostics()
  notifyLanguageClients()
  lspLog('client', 'all language clients stopped')
}

export async function syncOpenDocument(filePath: string, content: string): Promise<void> {
  const resolvedPath = resolveLspPath(filePath)
  const languageId = resolveEditorLanguage(resolvedPath)
  if (!isLspLanguageId(languageId) || getLanguageClientStatus(languageId).status !== 'running') return

  if (openedDocuments.has(resolvedPath)) {
    syncChangeDocument(filePath, content)
    return
  }

  const version = (documentVersions.get(resolvedPath) ?? 0) + 1
  documentVersions.set(resolvedPath, version)
  const request: LspDocumentSyncRequest = {
    languageId,
    path: resolvedPath,
    content,
    version,
    action: 'open'
  }
  lspLog('client', 'document open', { languageId, path: shortLspPath(resolvedPath), version })
  await unwrap(ipc.lsp.documentOpen(request))
  openedDocuments.add(resolvedPath)
  lastSyncedContent.set(resolvedPath, content)
}

/**
 * 在发起 LSP 功能请求前确保：语言服务已启动、文档已打开、缓冲区与服务器同步。
 * 对齐 VS Code LanguageClient 在 request 前的 document sync 行为。
 */
export async function ensureDocumentReadyForRequest(
  filePath: string,
  content: string
): Promise<string | null> {
  const resolvedPath = resolveLspPath(filePath)
  const languageId = resolveEditorLanguage(resolvedPath)
  if (!isLspLanguageId(languageId)) return null

  const root = workspaceRoot()
  if (!root) return null

  await ensureLanguageClient(resolvedPath, root)
  if (getLanguageClientStatus(languageId).status !== 'running') return null

  const pending = changeTimers.get(resolvedPath)
  if (pending) {
    clearTimeout(pending)
    changeTimers.delete(resolvedPath)
  }

  if (!openedDocuments.has(resolvedPath)) {
    await syncOpenDocument(resolvedPath, content)
    return languageId
  }

  if (lastSyncedContent.get(resolvedPath) !== content) {
    await flushDocumentChange(resolvedPath, languageId, content)
    lastSyncedContent.set(resolvedPath, content)
  }

  return languageId
}

export function syncChangeDocument(filePath: string, content: string): void {
  const resolvedPath = resolveLspPath(filePath)
  const languageId = resolveEditorLanguage(resolvedPath)
  if (!isLspLanguageId(languageId) || getLanguageClientStatus(languageId).status !== 'running') return

  if (!openedDocuments.has(resolvedPath)) {
    void syncOpenDocument(filePath, content)
    return
  }

  const pending = changeTimers.get(resolvedPath)
  if (pending) clearTimeout(pending)

  changeTimers.set(resolvedPath, setTimeout(() => {
    changeTimers.delete(resolvedPath)
    void flushDocumentChange(resolvedPath, languageId, content)
  }, LSP_SYNC_DEBOUNCE_MS))
}

async function flushDocumentChange(resolvedPath: string, languageId: string, content: string): Promise<void> {
  const version = (documentVersions.get(resolvedPath) ?? 0) + 1
  documentVersions.set(resolvedPath, version)
  await unwrap(ipc.lsp.documentChange({
    languageId,
    path: resolvedPath,
    content,
    version,
    action: 'change'
  }))
  lastSyncedContent.set(resolvedPath, content)
}

export async function syncCloseDocument(filePath: string): Promise<void> {
  const resolvedPath = resolveLspPath(filePath)
  const languageId = resolveEditorLanguage(resolvedPath)
  const pending = changeTimers.get(resolvedPath)
  if (pending) {
    clearTimeout(pending)
    changeTimers.delete(resolvedPath)
  }
  if (!openedDocuments.has(resolvedPath)) return

  const version = documentVersions.get(resolvedPath) ?? 1
  documentVersions.delete(resolvedPath)
  openedDocuments.delete(resolvedPath)
  lastSyncedContent.delete(resolvedPath)
  lspLog('client', 'document close', { languageId, path: shortLspPath(resolvedPath) })
  await unwrap(ipc.lsp.documentClose({
    languageId,
    path: resolvedPath,
    content: '',
    version,
    action: 'close'
  }))
}

export function getLanguageClientStatus(languageId: string): RegisteredLanguageClient {
  return statuses.get(languageId) ?? { languageId, status: 'idle' }
}

export function getLanguageClientForPath(filePath: string): RegisteredLanguageClient {
  return getLanguageClientStatus(resolveEditorLanguage(filePath))
}

export function listLanguageClients(): RegisteredLanguageClient[] {
  return [...statuses.values()]
}

function notifyLanguageClients(): void {
  const snapshot = listLanguageClients()
  for (const subscriber of languageClientSubscribers) subscriber(snapshot)
}

export function subscribeLanguageClients(
  callback: (clients: RegisteredLanguageClient[]) => void
): () => void {
  languageClientSubscribers.add(callback)
  callback(listLanguageClients())
  return () => languageClientSubscribers.delete(callback)
}
