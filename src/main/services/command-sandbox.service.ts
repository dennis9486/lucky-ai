import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createLogger } from '../../shared/utils/log.js'
import type {
  CommandSandboxExecuteOptions,
  CommandSandboxResult,
  SandboxBackend,
  SandboxIsolation,
  SandboxRuntimePolicy,
  SandboxStatus
} from '../../shared/types/sandbox.js'
import {
  DEFAULT_AGENT_SANDBOX_MODE,
  SANDBOX_DEFAULT_MAX_BUFFER_BYTES,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS
} from '../../shared/types/sandbox.js'
import { assertSandboxCommandAllowed, buildMacSeatbeltProfile, sanitizeProcessEnv } from './sandbox/sandbox-env.js'
import { securityService } from './security.service.js'
import { settingsService } from './settings.service.js'

const logger = createLogger('main/command-sandbox')

interface BackendDescriptor {
  isolation: SandboxIsolation
  sandboxed: boolean
  degraded: boolean
  networkEnforced: boolean
}

/** 依据实际使用的后端 + 策略，诚实推导隔离强度（不夸大保护）。 */
function describeBackend(backend: SandboxBackend, policy: SandboxRuntimePolicy): BackendDescriptor {
  if (backend === 'passthrough') {
    return { isolation: 'none', sandboxed: false, degraded: false, networkEnforced: false }
  }
  if (backend === 'docker-container') {
    // 容器级隔离：独立文件系统 + 命名空间；--network none 时网络真正被强制。
    return { isolation: 'os', sandboxed: true, degraded: false, networkEnforced: policy.networkPolicy === 'deny' }
  }
  if (backend === 'restricted-spawn') {
    // 无内核级隔离：仅净化环境 + 锁工作目录 + 命令/路径黑名单。
    // 若用户要的是 strict/balanced（mode !== off），这就是一次“降级”。
    return {
      isolation: 'workspace',
      sandboxed: false,
      degraded: policy.mode !== 'off',
      networkEnforced: false
    }
  }
  // macOS Seatbelt / Linux bubblewrap：内核级隔离，网络策略（allow/deny）均被真正强制。
  return {
    isolation: 'os',
    sandboxed: true,
    degraded: false,
    networkEnforced: true
  }
}

export class CommandSandboxService {
  async execute(options: CommandSandboxExecuteOptions): Promise<CommandSandboxResult> {
    const signal = options.signal
    if (signal?.aborted) {
      return this.abortedResult(await this.resolvePolicy(options))
    }

    const policy = await this.resolvePolicy(options)
    assertSandboxCommandAllowed(options.command, policy.mode === 'strict')
    await mkdir(join(policy.workspaceRoot, '.lucky', 'tmp'), { recursive: true })

    if (policy.mode === 'off') {
      return this.runPassthrough(options.command, policy, signal)
    }

    // 容器后端优先（用户开启且 docker 可用）：更强的可复现隔离，失败则回退到本地后端。
    if (policy.container && commandExists('docker')) {
      try {
        const result = await this.runDocker(options.command, policy, signal)
        // docker CLI 在但守护进程没起时，`docker run` 会以非零码正常退出、
        // 报错只在 stderr 里——不识别这种情况的话每条命令都会把连接错误
        // 当成「命令执行结果」返回给 Agent，降级路径永远不触发。
        if (!isDockerDaemonUnreachable(result)) return result
        logger.warn('docker daemon unreachable, falling back to local backend', {
          stderr: result.stderr.slice(0, 300)
        })
      } catch (error) {
        logger.warn('docker sandbox failed, falling back to local backend', { error })
      }
    }

    const backend = this.pickBackend()
    if (backend === 'restricted-spawn') {
      // 诚实告警：请求了 OS 级隔离却只能降级为工作区级（Windows / 无 bwrap 的 Linux）。
      logger.warn('OS-level sandbox unavailable, degrading to workspace isolation', {
        mode: policy.mode,
        platform: process.platform
      })
    }

    try {
      switch (backend) {
        case 'macos-seatbelt':
          return await this.runMacSeatbelt(options.command, policy, signal)
        case 'linux-bubblewrap':
          return await this.runBubblewrap(options.command, policy, signal)
        default:
          return await this.runRestrictedSpawn(options.command, policy, signal)
      }
    } catch (error) {
      logger.warn('sandbox backend failed, falling back to restricted spawn', { backend, error })
      return this.runRestrictedSpawn(options.command, policy, signal)
    }
  }

  private abortedResult(policy: SandboxRuntimePolicy): CommandSandboxResult {
    const descriptor = describeBackend('restricted-spawn', policy)
    return {
      exitCode: null,
      stdout: '',
      stderr: 'Command aborted by user.',
      backend: 'restricted-spawn',
      sandboxed: descriptor.sandboxed,
      isolation: descriptor.isolation,
      degraded: descriptor.degraded,
      timedOut: false,
      aborted: true,
      mode: policy.mode,
      networkPolicy: policy.networkPolicy,
      networkEnforced: descriptor.networkEnforced
    }
  }

  /** 当前沙箱隔离状态，供 UI 顶部常驻展示（不执行任何命令）。 */
  async getStatus(): Promise<SandboxStatus> {
    const settings = await settingsService.getSettings()
    const mode = settings.general?.agentSandbox ?? DEFAULT_AGENT_SANDBOX_MODE
    const containerActive = mode !== 'off' && Boolean(settings.general?.agentSandboxContainer) && commandExists('docker')
    const backend: SandboxBackend =
      mode === 'off' ? 'passthrough' : containerActive ? 'docker-container' : this.pickBackend()
    const osIsolationAvailable = this.osIsolationAvailable() || commandExists('docker')
    const networkPolicy = mode === 'strict' ? 'deny' : 'allow'
    const isolation: SandboxIsolation =
      mode === 'off' ? 'none' : backend === 'restricted-spawn' ? 'workspace' : 'os'
    return {
      mode,
      backend,
      isolation,
      osIsolationAvailable,
      networkPolicy,
      degraded: mode !== 'off' && isolation !== 'os',
      platform: process.platform,
      hasWorkspace: securityService.getWorkspaceRoot() != null
    }
  }

  private osIsolationAvailable(): boolean {
    if (process.platform === 'darwin') return commandExists('sandbox-exec')
    if (process.platform === 'linux') return commandExists('bwrap')
    return false
  }

  private async resolvePolicy(options: CommandSandboxExecuteOptions): Promise<SandboxRuntimePolicy> {
    const settings = await settingsService.getSettings()
    const mode = options.mode ?? settings.general.agentSandbox ?? DEFAULT_AGENT_SANDBOX_MODE
    const workspaceRoot = securityService.getWorkspaceRoot()
    if (!workspaceRoot) throw new Error('未打开工作区')

    const workdir = options.cwd
      ? securityService.resolveSafePath(options.cwd)
      : workspaceRoot

    const timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, 1),
      SANDBOX_MAX_TIMEOUT_MS
    )

    return {
      mode,
      networkPolicy: mode === 'strict' ? 'deny' : 'allow',
      workspaceRoot,
      workdir,
      timeoutMs,
      maxBufferBytes: options.maxBufferBytes ?? SANDBOX_DEFAULT_MAX_BUFFER_BYTES,
      container: Boolean(settings.general?.agentSandboxContainer),
      containerImage: settings.general?.agentSandboxImage?.trim() || 'node:20-alpine'
    }
  }

  /**
   * 在 Docker 容器中执行：独立文件系统/命名空间。POSIX 平台工作区按原路径挂载
   * （容器内外路径一致，避免路径错位）；Windows 宿主路径（C:\...）不是合法的
   * Linux 容器路径，统一挂载到 /workspace 并映射 workdir。
   * 丢弃全部 capability + no-new-privileges；strict 模式 --network none 断网。
   * docker CLI 本身需宿主 env（PATH/DOCKER_HOST）才能连上守护进程——隔离发生在容器内，与此无关。
   */
  private async runDocker(command: string, policy: SandboxRuntimePolicy, signal?: AbortSignal): Promise<CommandSandboxResult> {
    const image = policy.containerImage || 'node:20-alpine'
    const network = policy.networkPolicy === 'deny' ? 'none' : 'bridge'
    const mount = mapDockerPaths(policy.workspaceRoot, policy.workdir, process.platform)
    const args = [
      'run', '--rm',
      '--network', network,
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '-v', `${policy.workspaceRoot}:${mount.containerRoot}`,
      '-w', mount.containerWorkdir,
      '-e', 'LUCKY_SANDBOX=docker',
      image,
      'sh', '-c', command
    ]
    return this.spawnTracked('docker', args, policy, 'docker-container', process.env as NodeJS.ProcessEnv, signal)
  }

  private pickBackend(): SandboxBackend {
    if (process.platform === 'darwin' && commandExists('sandbox-exec')) return 'macos-seatbelt'
    if (process.platform === 'linux' && commandExists('bwrap')) return 'linux-bubblewrap'
    return 'restricted-spawn'
  }

  private async runMacSeatbelt(command: string, policy: SandboxRuntimePolicy, signal?: AbortSignal): Promise<CommandSandboxResult> {
    const profile = buildMacSeatbeltProfile(policy.workspaceRoot, policy.networkPolicy)
    const profileDir = await mkdtemp(join(tmpdir(), 'lucky-sandbox-'))
    const profilePath = join(profileDir, 'profile.sb')
    await writeFile(profilePath, profile, 'utf-8')

    try {
      const shell = '/bin/bash'
      const args = [
        '-f', profilePath,
        '--',
        shell,
        '--noprofile',
        '--norc',
        '-c',
        command
      ]
      return await this.spawnTracked('sandbox-exec', args, policy, 'macos-seatbelt', undefined, signal)
    } finally {
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async runBubblewrap(command: string, policy: SandboxRuntimePolicy, signal?: AbortSignal): Promise<CommandSandboxResult> {
    const args = [
      '--die-with-parent',
      // 分离所有命名空间以最大化隔离；网络按策略单独放行。
      '--unshare-all',
      ...(policy.networkPolicy === 'allow' ? ['--share-net'] : []),
      // 丢弃全部 capability，防止提权类操作。
      '--cap-drop', 'ALL',
      // 新建会话，阻断 TIOCSTI 终端注入。
      '--new-session',
      '--proc', '/proc',
      '--dev', '/dev',
      '--tmpfs', '/tmp',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind', '/lib', '/lib',
      ...(await pathExists('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
      ...(await pathExists('/etc') ? ['--ro-bind', '/etc', '/etc'] : []),
      ...(await pathExists('/opt') ? ['--ro-bind', '/opt', '/opt'] : []),
      '--bind', policy.workspaceRoot, policy.workspaceRoot,
      '--chdir', policy.workdir,
      '--',
      '/bin/bash',
      '--noprofile',
      '--norc',
      '-c',
      command
    ]

    return this.spawnTracked('bwrap', args, policy, 'linux-bubblewrap', undefined, signal)
  }

  private async runRestrictedSpawn(command: string, policy: SandboxRuntimePolicy, signal?: AbortSignal): Promise<CommandSandboxResult> {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['--noprofile', '--norc', '-c', command]
    return this.spawnTracked(shell, args, policy, 'restricted-spawn', undefined, signal)
  }

  private async runPassthrough(command: string, policy: SandboxRuntimePolicy, signal?: AbortSignal): Promise<CommandSandboxResult> {
    const shell = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash')
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]
    return this.spawnTracked(shell, args, policy, 'passthrough', process.env as NodeJS.ProcessEnv, signal)
  }

  private spawnTracked(
    executable: string,
    args: string[],
    policy: SandboxRuntimePolicy,
    backend: SandboxBackend,
    rawEnv?: NodeJS.ProcessEnv,
    signal?: AbortSignal
  ): Promise<CommandSandboxResult> {
    const descriptor = describeBackend(backend, policy)
    const { env } = rawEnv
      ? { env: Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value !== undefined)) as Record<string, string> }
      : sanitizeProcessEnv(process.env, policy.workspaceRoot, policy.mode === 'strict')

    return new Promise((resolve) => {
      const proc = spawn(executable, args, {
        cwd: policy.workdir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }) as ChildProcess

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let aborted = false
      let settled = false

      const onAbort = () => {
        if (settled) return
        aborted = true
        proc.kill('SIGKILL')
      }
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGKILL')
      }, policy.timeoutMs)

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        if (stdout.length > policy.maxBufferBytes) {
          stdout = stdout.slice(0, policy.maxBufferBytes)
          proc.kill('SIGKILL')
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        if (stderr.length > policy.maxBufferBytes) {
          stderr = stderr.slice(0, policy.maxBufferBytes)
          proc.kill('SIGKILL')
        }
      })

      const finish = (exitCode: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve({
          exitCode,
          stdout,
          stderr,
          backend,
          sandboxed: descriptor.sandboxed,
          isolation: descriptor.isolation,
          degraded: descriptor.degraded,
          timedOut,
          aborted,
          mode: policy.mode,
          networkPolicy: policy.networkPolicy,
          networkEnforced: descriptor.networkEnforced
        })
      }

      proc.on('error', (error) => {
        stderr = stderr ? `${stderr}\n${error.message}` : error.message
        finish(1)
      })

      proc.on('close', (code) => finish(code))
    })
  }
}

export const commandSandboxService = new CommandSandboxService()

/**
 * 宿主路径 → 容器路径映射。
 * POSIX：原路径直挂（容器内外一致）。Windows：宿主是 `C:\...` 形态，无法作为
 * Linux 容器内路径，统一挂到 /workspace，workdir 转成相对子路径拼接。
 */
export function mapDockerPaths(
  workspaceRoot: string,
  workdir: string,
  platform: NodeJS.Platform
): { containerRoot: string; containerWorkdir: string } {
  if (platform !== 'win32') {
    return { containerRoot: workspaceRoot, containerWorkdir: workdir }
  }
  const containerRoot = '/workspace'
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedWorkdir = workdir.replace(/\\/g, '/')
  const rel = normalizedWorkdir.toLowerCase().startsWith(normalizedRoot.toLowerCase())
    ? normalizedWorkdir.slice(normalizedRoot.length).replace(/^\/+/, '')
    : ''
  return {
    containerRoot,
    containerWorkdir: rel ? `${containerRoot}/${rel}` : containerRoot
  }
}

/**
 * 缓存可执行文件探测结果。沙箱后端（sandbox-exec/bwrap）的存在与否在应用生命周期内不变，
 * 而 pickBackend() 会在每次命令执行时调用——不缓存则每条命令都在主进程同步 fork 一次
 * which/where 子进程，阻塞事件循环。
 */
const commandExistsCache = new Map<string, boolean>()

/**
 * docker CLI 存在但守护进程不可达时的 stderr 特征（覆盖 Docker Desktop 未启动、
 * daemon 停止、socket 缺失等场景，跨 docker 版本/OS 的常见文案）。
 */
const DOCKER_DAEMON_UNREACHABLE_RE = /(cannot connect to the docker daemon|failed to connect to the docker api|is the (docker )?daemon running|docker daemon is not running|error during connect|docker\.sock.*(no such file or directory|connection refused))/i

/** `docker run` 非零退出且 stderr 是「连不上守护进程」→ 视为后端不可用而非命令失败 */
export function isDockerDaemonUnreachable(result: Pick<CommandSandboxResult, 'exitCode' | 'stderr'>): boolean {
  if (result.exitCode === 0) return false
  return DOCKER_DAEMON_UNREACHABLE_RE.test(result.stderr)
}

function commandExists(name: string): boolean {
  const cached = commandExistsCache.get(name)
  if (cached !== undefined) return cached
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(lookup, [name], { stdio: 'ignore' })
  const exists = result.status === 0
  commandExistsCache.set(name, exists)
  return exists
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function formatSandboxResult(result: CommandSandboxResult, command: string): string {
  const meta =
    `[sandbox:${result.backend}; isolation:${result.isolation}; mode:${result.mode}; ` +
    `network:${result.networkPolicy}${result.networkPolicy === 'deny' && !result.networkEnforced ? '(not enforced)' : ''}]`
  // 诚实告警：非 OS 级隔离时，网络/工作区外访问未被内核强制阻断。
  const warning =
    result.degraded
      ? '⚠️ 无 OS 级隔离，已降级为工作区级：网络与工作区外的敏感路径未被内核强制隔离。\n'
      : ''

  if (result.timedOut) {
    return `${warning}${meta}\nCommand timed out: ${command}\n${result.stdout}\n${result.stderr}`.trim()
  }
  if (result.exitCode === 0) {
    return warning ? `${warning}${result.stdout || `${meta}\n(exit 0, no stdout)`}` : (result.stdout || `${meta}\n(exit 0, no stdout)`)
  }
  const chunks = [`${warning}${meta}\nCommand failed: ${command}`]
  if (result.stdout.trim()) chunks.push(`Stdout:\n${result.stdout}`)
  if (result.stderr.trim()) chunks.push(`Stderr:\n${result.stderr}`)
  if (!result.stderr.trim() && result.exitCode !== null) chunks.push(`Exit code: ${result.exitCode}`)
  return chunks.join('\n')
}
