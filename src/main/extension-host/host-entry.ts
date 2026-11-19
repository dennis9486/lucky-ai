/**
 * 扩展宿主进程入口（Electron utilityProcess）。
 *
 * 参照 VSCode 的 Extension Host：第三方扩展代码在**独立进程**里加载运行，与主进程隔离——
 * 崩溃/卡死/恶意代码都困在本进程内，拿不到主进程的 app / 窗口 / 会话状态。
 * 与主进程 broker 通过 `process.parentPort` 收发结构化消息（见 protocol.ts）。
 *
 * 本文件由 electron.vite 作为独立入口打包成 out/main/extension-host.js，
 * broker 用 utilityProcess.fork() 拉起。**不得 import electron**（utilityProcess 里没有）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { createExtensionContext, createVscodeApi, type VscodeDisposable } from './vscode-api.js'
import type { ExtensionManifestSummary } from '../../shared/types/extension.js'
import type { ActivateRequest, ExecuteCommandRequest, HostMessage, HostRequest } from './protocol.js'

interface ParentPort {
  postMessage: (message: unknown) => void
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  start?: () => void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

const commandHandlers = new Map<string, { extensionId: string; handler: (...args: unknown[]) => unknown }>()
const activated = new Map<string, { deactivate?: () => void | Promise<void> }>()
const messages: Array<{ extensionId: string; level: 'info' | 'warn' | 'error'; message: string }> = []

function post(message: HostMessage): void {
  parentPort?.postMessage(message)
}

function loadCommonJsExtension(
  entryPath: string,
  vscodeApi: Record<string, unknown>
): { activate?: (context: unknown) => unknown; deactivate?: () => unknown } {
  const code = readFileSync(entryPath, 'utf8')
  const extensionRequire = createRequire(entryPath)
  const moduleRef = { exports: {} as { activate?: (context: unknown) => unknown; deactivate?: () => unknown } }
  const sandbox: Record<string, unknown> = {
    module: moduleRef,
    exports: moduleRef.exports,
    require: (id: string) => (id === 'vscode' ? vscodeApi : extensionRequire(id)),
    __dirname: dirname(entryPath),
    __filename: entryPath,
    console,
    process,
    Buffer,
    setImmediate,
    clearImmediate,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  }
  vm.runInNewContext(code, sandbox, { filename: entryPath, timeout: 10_000 })
  return moduleRef.exports
}

async function activateExtension(extension: ExtensionManifestSummary, workspaceRoot?: string): Promise<void> {
  if (activated.has(extension.id)) return
  const entryPath = join(extension.path, extension.main!)
  const subscriptions: VscodeDisposable[] = []
  const vscodeApi = createVscodeApi({
    extension,
    workspaceRoot,
    registerCommand: (command, handler) => {
      commandHandlers.set(command, { extensionId: extension.id, handler })
      post({ type: 'register-command', command, extensionId: extension.id })
      return () => {
        commandHandlers.delete(command)
        post({ type: 'unregister-command', command })
      }
    },
    emitMessage: (level, message) => {
      messages.push({ extensionId: extension.id, level, message })
      post({ type: 'log', extensionId: extension.id, level, message })
    },
    executeCommand: (command, args) => commandHandlers.get(command)?.handler(...args)
  })
  const exports = loadCommonJsExtension(entryPath, vscodeApi)
  const context = createExtensionContext(extension, subscriptions)
  if (typeof exports.activate === 'function') await exports.activate(context)
  activated.set(extension.id, {
    deactivate: typeof exports.deactivate === 'function' ? () => { void exports.deactivate?.() } : undefined
  })
}

async function handleActivate(request: ActivateRequest): Promise<void> {
  const activatedExtensionIds: string[] = []
  const failed: Array<{ extensionId: string; error: string }> = []
  for (const extension of request.extensions) {
    if (!extension.main || extension.browser) continue
    try {
      await activateExtension(extension, request.workspaceRoot)
      activatedExtensionIds.push(extension.id)
    } catch (error) {
      failed.push({ extensionId: extension.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  post({
    type: 'activated',
    requestId: request.requestId,
    result: {
      activatedExtensionIds,
      failed,
      registeredCommands: [...commandHandlers.keys()],
      messages: messages.slice(-50)
    }
  })
}

async function handleExecuteCommand(request: ExecuteCommandRequest): Promise<void> {
  const entry = commandHandlers.get(request.command)
  if (!entry) {
    post({ type: 'command-result', requestId: request.requestId, ok: false, error: `Extension command not found: ${request.command}` })
    return
  }
  try {
    const value = await entry.handler(...request.args)
    post({ type: 'command-result', requestId: request.requestId, ok: true, value: toCloneable(value) })
  } catch (error) {
    post({ type: 'command-result', requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 命令返回值可能含不可结构化克隆的对象；退化为 JSON 往返，无法序列化则返回 undefined。 */
function toCloneable(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

async function handleDeactivate(): Promise<void> {
  for (const entry of activated.values()) {
    try { await entry.deactivate?.() } catch { /* ignore */ }
  }
  activated.clear()
  commandHandlers.clear()
}

parentPort?.on('message', (event) => {
  const request = event.data as HostRequest
  if (request.type === 'activate') void handleActivate(request)
  else if (request.type === 'execute-command') void handleExecuteCommand(request)
  else if (request.type === 'deactivate') void handleDeactivate()
})
parentPort?.start?.()

post({ type: 'ready' })
