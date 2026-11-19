import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { ExtensionManifestSummary, ExtensionRuntimeResult } from '../../shared/types/extension.js'
import { createLogger } from '../../shared/utils/log.js'
import type { HostMessage } from '../extension-host/protocol.js'

const ACTIVATE_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 扩展运行时 broker。
 *
 * 参照 VSCode：第三方扩展代码全部跑在独立的 utilityProcess（extension-host.js）里，与主进程隔离；
 * 本类只负责拉起/管理该进程、转发激活/命令请求、汇总命令表与消息。扩展崩溃只影响宿主进程，
 * 主进程按需重新 fork。公开 API（activateExtensions/executeCommand/listCommands）保持不变，
 * 上层 IPC 与渲染层无需改动。
 */
export class ExtensionRuntimeService {
  private child: UtilityProcess | null = null
  private readyPromise: Promise<boolean> | null = null
  private resolveReady: ((ready: boolean) => void) | null = null
  private requestId = 0
  private readonly pending = new Map<number, PendingRequest>()
  /** command → extensionId（''表示来自激活结果、尚无来源标注） */
  private readonly commands = new Map<string, string>()
  private readonly logger = createLogger('main/extension-host')

  private hostEntryPath(): string {
    // 由 electron.vite 作为独立 main 入口打包；dev 与打包后均在 out/main 下
    return join(app.getAppPath(), 'out', 'main', 'extension-host.js')
  }

  private ensureChild(): Promise<boolean> {
    if (this.child && this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<boolean>((resolve) => { this.resolveReady = resolve })
    try {
      const child = utilityProcess.fork(this.hostEntryPath(), [], { serviceName: 'lucky-extension-host' })
      this.child = child
      child.on('message', (message: HostMessage) => this.onMessage(message))
      child.on('exit', (code) => {
        this.logger.warn('extension host exited', { code })
        this.teardown(new Error('扩展宿主进程已退出'))
      })
      this.logger.info('extension host forked', { path: this.hostEntryPath() })
    } catch (error) {
      this.logger.error('failed to fork extension host', { error })
      this.resolveReady?.(false)
      this.readyPromise = Promise.resolve(false)
    }
    return this.readyPromise
  }

  private teardown(reason: Error): void {
    this.child = null
    this.commands.clear()
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(reason)
    }
    this.pending.clear()
    this.resolveReady?.(false)
    this.readyPromise = null
    this.resolveReady = null
  }

  private onMessage(message: HostMessage): void {
    switch (message.type) {
      case 'ready':
        this.resolveReady?.(true)
        break
      case 'activated':
        for (const command of message.result.registeredCommands) {
          if (!this.commands.has(command)) this.commands.set(command, '')
        }
        this.settle(message.requestId, null, message.result)
        break
      case 'command-result':
        this.settle(message.requestId, message.ok ? null : new Error(message.error ?? '命令执行失败'), message.value)
        break
      case 'register-command':
        this.commands.set(message.command, message.extensionId)
        break
      case 'unregister-command':
        this.commands.delete(message.command)
        break
      case 'log': {
        const extensionLogger = this.logger.child(message.extensionId)
        if (message.level === 'error') extensionLogger.error('extension message', { message: message.message })
        else if (message.level === 'warn') extensionLogger.warn('extension message', { message: message.message })
        else extensionLogger.info('extension message', { message: message.message })
        break
      }
    }
  }

  private settle(requestId: number, error: Error | null, value?: unknown): void {
    const request = this.pending.get(requestId)
    if (!request) return
    clearTimeout(request.timer)
    this.pending.delete(requestId)
    if (error) request.reject(error)
    else request.resolve(value)
  }

  private request<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const child = this.child
    if (!child) return Promise.reject(new Error('扩展宿主进程不可用'))
    const requestId = ++this.requestId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('扩展宿主响应超时'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer })
      child.postMessage({ ...payload, requestId })
    })
  }

  async activateExtensions(
    extensions: ExtensionManifestSummary[],
    workspaceRoot?: string
  ): Promise<ExtensionRuntimeResult> {
    const ready = await this.ensureChild()
    if (!ready || !this.child) {
      return {
        activatedExtensionIds: [],
        failed: extensions
          .filter((extension) => extension.main && !extension.browser)
          .map((extension) => ({ extensionId: extension.id, error: '扩展宿主进程不可用' })),
        registeredCommands: [...this.commands.keys()],
        messages: []
      }
    }
    return this.request<ExtensionRuntimeResult>({ type: 'activate', workspaceRoot, extensions }, ACTIVATE_TIMEOUT_MS)
  }

  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    const ready = await this.ensureChild()
    if (!ready || !this.child) throw new Error('扩展宿主进程不可用')
    return this.request<unknown>({ type: 'execute-command', command, args }, COMMAND_TIMEOUT_MS)
  }

  listCommands(): string[] {
    return [...this.commands.keys()]
  }

  /** 应用退出时优雅终止宿主进程（不调用也会随主进程一并退出）。 */
  dispose(): void {
    try {
      this.child?.postMessage({ type: 'deactivate' })
      this.child?.kill()
    } catch { /* ignore */ }
    this.teardown(new Error('扩展宿主已释放'))
  }
}

export const extensionRuntimeService = new ExtensionRuntimeService()
