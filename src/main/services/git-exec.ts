/**
 * git-exec.ts — Git 命令执行层（参考 VS Code git 扩展的 git.ts / OperationManager）
 *
 * 统一解决四类问题：
 * 1. 环境卫生：GIT_TERMINAL_PROMPT=0 禁止凭证交互（否则 pull/push 会无限挂起等待
 *    一个不存在的终端）；读操作 GIT_OPTIONAL_LOCKS=0 不抢 index.lock；LC_ALL 固定
 *    英文输出保证错误分类正则稳定；core.quotepath=false 保证非 ASCII 路径不转义。
 * 2. 超时：所有命令带超时（网络类更宽），杜绝僵死进程。
 * 3. 错误分类：stderr → GitErrorCode + 面向用户的中文提示（原始输出保留在
 *    GitError.stderr 供排查），仿 VS Code 的 GitErrorCodes。
 * 4. 写操作串行化：同一仓库的变更命令经互斥队列排队（仿 OperationManager），
 *    防止 UI 操作与 Agent/定时任务并发触发 "Unable to create index.lock"。
 *
 * 使用约定：
 * - 读操作：execGit / execGitBuffer（并行安全，不抢锁）。
 * - 单命令写操作：execGitLocked。
 * - 多命令写序列（如 discard 的 restore+clean、hunk 的 diff+apply）：
 *   withRepoLock(cwd, fn)，fn 内部用 execGit（已在锁内，勿再嵌套 Locked 变体）。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const execFileAsync = promisify(execFile)

/** 单命令输出缓冲上限 */
const MAX_BUFFER = 4 * 1024 * 1024
/** 本地命令默认超时 */
const DEFAULT_TIMEOUT_MS = 30_000
/** 网络类命令（fetch/pull/push/clone）超时 */
const NETWORK_TIMEOUT_MS = 120_000

/** 需要网络的 git 子命令（用于选择超时档位） */
const NETWORK_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote'])

export type GitErrorCode =
  | 'auth'
  | 'noUpstream'
  | 'conflict'
  | 'dirtyWorktree'
  | 'notRepository'
  | 'lockExists'
  | 'remoteRejected'
  | 'network'
  | 'emptyCommit'
  | 'noStash'
  | 'refNotFound'
  | 'timeout'
  | 'unknown'

/** 分类后的 Git 错误：message 面向用户，stderr 保留原始输出供排查 */
export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly args: string[],
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/** stderr 特征 → 错误码 + 中文提示（顺序即优先级，命中即止） */
const ERROR_RULES: Array<{ pattern: RegExp; code: GitErrorCode; message: string }> = [
  {
    pattern: /authentication failed|could not read username|could not read password|invalid username or password|terminal prompts disabled|permission denied \(publickey\)/i,
    code: 'auth',
    message: '远程仓库认证失败：请检查凭证配置（HTTPS 凭证或 SSH key）'
  },
  {
    pattern: /no upstream|has no upstream branch|no tracking information/i,
    code: 'noUpstream',
    message: '当前分支未设置上游分支：请先推送并建立跟踪（push -u）'
  },
  {
    pattern: /\bCONFLICT\b|automatic merge failed|needs merge|resolve your current index first/i,
    code: 'conflict',
    message: '存在合并冲突：请先在「更改」列表中解决冲突文件'
  },
  {
    pattern: /your local changes to the following files would be overwritten|commit your changes or stash them/i,
    code: 'dirtyWorktree',
    message: '本地未提交的修改会被覆盖：请先提交或 stash 暂存'
  },
  {
    pattern: /not a git repository/i,
    code: 'notRepository',
    message: '当前目录不是 Git 仓库'
  },
  {
    pattern: /unable to create .*index\.lock|index\.lock.*exists|another git process/i,
    code: 'lockExists',
    message: '另一个 Git 进程正在操作该仓库（index.lock 被占用），请稍后重试'
  },
  {
    pattern: /\[rejected\]|failed to push some refs|non-fast-forward|fetch first/i,
    code: 'remoteRejected',
    message: '推送被拒绝：远程分支有新提交，请先拉取（pull）再推送'
  },
  {
    pattern: /could not resolve host|unable to access|connection (timed out|refused|reset)|network is unreachable|couldn't find remote ref/i,
    code: 'network',
    message: '无法访问远程仓库：请检查网络连接与远程地址'
  },
  {
    pattern: /nothing to commit|no changes added to commit/i,
    code: 'emptyCommit',
    message: '没有可提交的变更'
  },
  {
    pattern: /no stash entries found|is not a valid reference|unknown stash/i,
    code: 'noStash',
    message: '没有对应的 stash 记录'
  },
  {
    pattern: /pathspec .* did not match|unknown revision or path|invalid reference|did not match any file/i,
    code: 'refNotFound',
    message: '未找到对应的分支、提交或文件'
  }
]

/**
 * 把 git 的 stderr 分类为 GitErrorCode。
 * 未命中任何规则时返回 unknown，message 回退为 stderr 首个非空行。
 */
export function classifyGitError(stderr: string, args: string[] = []): GitError {
  const text = stderr.trim()
  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(text)) {
      return new GitError(rule.code, rule.message, args, text)
    }
  }
  const firstLine = text.split('\n').find((line) => line.trim()) ?? ''
  const message = firstLine.replace(/^(fatal|error):\s*/i, '').trim() || `Git 命令失败: git ${args.join(' ')}`
  return new GitError('unknown', message, args, text)
}

interface RawExecError extends Error {
  stderr?: string | Buffer
  killed?: boolean
  signal?: string
  code?: string | number
}

/** 把 execFile 的失败统一转换为 GitError */
function toGitError(e: unknown, args: string[], timeoutMs: number): GitError {
  const raw = e as RawExecError
  if (raw.killed || raw.signal === 'SIGTERM') {
    return new GitError('timeout', `Git 操作超时（${Math.round(timeoutMs / 1000)}s）: git ${args.join(' ')}`, args, '')
  }
  const stderr = typeof raw.stderr === 'string' ? raw.stderr : raw.stderr?.toString('utf-8') ?? ''
  if (stderr.trim()) return classifyGitError(stderr, args)
  return new GitError('unknown', raw.message || `Git 命令失败: git ${args.join(' ')}`, args, '')
}

/**
 * 构造 git 子进程环境。
 * - GIT_TERMINAL_PROMPT=0：无终端环境下禁止凭证/主机指纹交互，失败而非挂起。
 * - LC_ALL/LANG：固定英文输出，错误分类与解析不受系统语言影响。
 * - 读操作追加 GIT_OPTIONAL_LOCKS=0：后台状态查询不创建可选锁。
 */
function buildGitEnv(readOnly: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'en_US.UTF-8',
    LANG: 'en_US.UTF-8',
    ...(readOnly ? { GIT_OPTIONAL_LOCKS: '0' } : {})
  }
}

function resolveTimeout(args: string[], timeoutMs?: number): number {
  if (timeoutMs) return timeoutMs
  const subcommand = args.find((arg) => !arg.startsWith('-') && arg !== 'core.quotepath=false')
  return subcommand && NETWORK_SUBCOMMANDS.has(subcommand) ? NETWORK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
}

export interface GitExecOptions {
  /** 覆盖默认超时（网络类命令默认 120s，其余 30s） */
  timeoutMs?: number
  /** 内部标记：写操作不带 GIT_OPTIONAL_LOCKS=0 */
  readOnly?: boolean
}

/**
 * 执行 git 命令（文本输出）。读操作并行安全；写操作请使用
 * execGitLocked 或在 withRepoLock 内调用。
 */
export async function execGit(
  cwd: string,
  args: string[],
  options: GitExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = ['-c', 'core.quotepath=false', ...args]
  const timeoutMs = resolveTimeout(args, options.timeoutMs)
  try {
    return await execFileAsync('git', fullArgs, {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      env: buildGitEnv(options.readOnly !== false)
    })
  } catch (e) {
    throw toGitError(e, args, timeoutMs)
  }
}

/** 执行 git 命令（二进制输出，供 git show 读取可能非 UTF-8 的文件内容） */
export async function execGitBuffer(cwd: string, args: string[], options: GitExecOptions = {}): Promise<Buffer> {
  const fullArgs = ['-c', 'core.quotepath=false', ...args]
  const timeoutMs = resolveTimeout(args, options.timeoutMs)
  try {
    const { stdout } = await execFileAsync('git', fullArgs, {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      encoding: 'buffer',
      env: buildGitEnv(options.readOnly !== false)
    })
    return stdout
  } catch (e) {
    throw toGitError(e, args, timeoutMs)
  }
}

/** 每个仓库一条写操作队列（key 为规整后的仓库根路径） */
const repoLocks = new Map<string, Promise<unknown>>()

/**
 * 仓库级互斥：同一仓库的写操作串行执行，防止并发触发 index.lock 冲突。
 * 不可在 fn 内再嵌套 withRepoLock/execGitLocked（会死锁）。
 */
export function withRepoLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(cwd)
  const tail = repoLocks.get(key) ?? Promise.resolve()
  const run = tail.then(fn, fn)
  repoLocks.set(key, run.catch(() => undefined))
  return run
}

/** 单命令写操作：入队串行执行 */
export function execGitLocked(
  cwd: string,
  args: string[],
  options: GitExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return withRepoLock(cwd, () => execGit(cwd, args, { ...options, readOnly: false }))
}

/** 仅测试使用 */
export const gitExecInternalsForTest = {
  ERROR_RULES,
  resolveTimeout,
  buildGitEnv
}
