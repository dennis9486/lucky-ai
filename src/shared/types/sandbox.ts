/** Agent shell execution isolation profile. */
export type AgentSandboxMode = 'strict' | 'balanced' | 'off'

export type SandboxBackend = 'docker-container' | 'macos-seatbelt' | 'linux-bubblewrap' | 'restricted-spawn' | 'passthrough'

export type SandboxNetworkPolicy = 'deny' | 'allow'

/**
 * 实际生效的隔离强度（诚实上报，不夸大）：
 * - `os`：内核级隔离（macOS Seatbelt / Linux bubblewrap），文件系统与网络策略真正被强制。
 * - `workspace`：仅工作区级——净化环境变量 + 工作目录锁定 + 命令/路径黑名单，但**无**内核级
 *   文件系统/网络隔离（restricted-spawn 回退，如 Windows 或缺少 bwrap 的 Linux）。
 * - `none`：关闭沙箱（passthrough），直接以宿主环境运行。
 */
export type SandboxIsolation = 'os' | 'workspace' | 'none'

export interface CommandSandboxExecuteOptions {
  command: string
  cwd?: string
  timeoutMs?: number
  maxBufferBytes?: number
  /** 用户中止 Agent 轮次时取消在途命令 */
  signal?: AbortSignal
  /** Override settings-derived mode for tests or emergency bypass. */
  mode?: AgentSandboxMode
}

export interface CommandSandboxResult {
  exitCode: number | null
  stdout: string
  stderr: string
  backend: SandboxBackend
  /** 真正的内核级隔离才为 true（等价于 isolation === 'os'）。 */
  sandboxed: boolean
  /** 诚实的隔离强度分级。 */
  isolation: SandboxIsolation
  /** 请求了 os 级隔离（strict/balanced）但当前平台/后端无法提供，已降级运行。 */
  degraded: boolean
  timedOut: boolean
  /** 由 AbortSignal 触发终止（用户 Stop） */
  aborted?: boolean
  mode: AgentSandboxMode
  networkPolicy: SandboxNetworkPolicy
  /** 网络策略是否被内核真正强制（deny 仅在 os 后端可强制）。 */
  networkEnforced: boolean
}

export interface SandboxRuntimePolicy {
  mode: AgentSandboxMode
  networkPolicy: SandboxNetworkPolicy
  workspaceRoot: string
  workdir: string
  timeoutMs: number
  maxBufferBytes: number
  /** 优先在 Docker 容器中执行（可用时），提供更强的可复现隔离环境。 */
  container?: boolean
  /** 容器镜像（container=true 时生效）。 */
  containerImage?: string
}

/** 供 UI 顶部常驻展示的当前沙箱隔离状态（不执行任何命令）。 */
export interface SandboxStatus {
  mode: AgentSandboxMode
  backend: SandboxBackend
  isolation: SandboxIsolation
  /** 当前平台是否具备内核级隔离后端（seatbelt/bwrap）。 */
  osIsolationAvailable: boolean
  networkPolicy: SandboxNetworkPolicy
  /** 请求了 os 隔离却只能降级为 workspace 级。 */
  degraded: boolean
  platform: NodeJS.Platform
  /** 是否已打开工作区（未打开时沙箱不可用）。 */
  hasWorkspace: boolean
}

export const DEFAULT_AGENT_SANDBOX_MODE: AgentSandboxMode = 'balanced'

export const SANDBOX_DEFAULT_TIMEOUT_MS = 120_000
export const SANDBOX_MAX_TIMEOUT_MS = 600_000
export const SANDBOX_DEFAULT_MAX_BUFFER_BYTES = 30 * 1024 * 1024
