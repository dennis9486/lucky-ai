import type { ExtensionManifestSummary, ExtensionRuntimeResult } from '../../shared/types/extension.js'

/**
 * 扩展宿主进程（utilityProcess）↔ 主进程 broker 之间的 RPC 协议。
 *
 * 参照 VSCode：扩展代码在独立进程里跑，永不进主进程。所有消息都必须是可结构化克隆的
 * （postMessage 的约束），因此只传纯数据；命令入参/返回值也须可克隆。
 */

// ---- 主进程 → 宿主 -----------------------------------------------------------
export interface ActivateRequest {
  type: 'activate'
  requestId: number
  workspaceRoot?: string
  extensions: ExtensionManifestSummary[]
}

export interface ExecuteCommandRequest {
  type: 'execute-command'
  requestId: number
  command: string
  args: unknown[]
}

export interface DeactivateRequest {
  type: 'deactivate'
}

export type HostRequest = ActivateRequest | ExecuteCommandRequest | DeactivateRequest

// ---- 宿主 → 主进程 -----------------------------------------------------------
export interface ReadyMessage {
  type: 'ready'
}

export interface ActivatedMessage {
  type: 'activated'
  requestId: number
  result: ExtensionRuntimeResult
}

export interface CommandResultMessage {
  type: 'command-result'
  requestId: number
  ok: boolean
  value?: unknown
  error?: string
}

/** 扩展在 activate 之后动态注册/注销命令（如 onCommand 激活），让 broker 的命令表实时同步。 */
export interface RegisterCommandMessage {
  type: 'register-command'
  command: string
  extensionId: string
}

export interface UnregisterCommandMessage {
  type: 'unregister-command'
  command: string
}

export interface LogMessage {
  type: 'log'
  extensionId: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type HostMessage =
  | ReadyMessage
  | ActivatedMessage
  | CommandResultMessage
  | RegisterCommandMessage
  | UnregisterCommandMessage
  | LogMessage
