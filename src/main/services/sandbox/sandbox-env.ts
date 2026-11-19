import { homedir } from 'node:os'
import { join } from 'node:path'

const BLOCKED_ENV_KEYS = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'PYTHONPATH',
  'RUBYLIB',
  'PERL5LIB',
  'BASH_ENV',
  'ENV',
  'SHELL',
  'ZDOTDIR',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CURSOR_API_KEY',
  'NPM_TOKEN',
  'PNPM_HOME'
])

const SECRET_ENV_SUFFIXES = ['_API_KEY', '_SECRET', '_TOKEN', '_PASSWORD', '_PRIVATE_KEY']

/** 名称中包含这些片段的一律视为敏感（防止非后缀命名的凭据泄漏，如 GH_TOKEN_FOO / MY_SECRET_X）。 */
const SECRET_ENV_SUBSTRINGS = ['SECRET', 'PASSWORD', 'PASSWD', 'CREDENTIAL', 'PRIVATE_KEY', 'ACCESS_KEY', 'APIKEY']

/**
 * 严格模式下允许透传的“安全”环境变量白名单（除此之外全部丢弃）。
 * PATH/HOME/TMP* 等由 sanitizeProcessEnv 显式重写，不依赖白名单。
 */
const STRICT_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'CI',
  'NO_COLOR',
  'FORCE_COLOR',
  'PWD',
  'SHLVL',
  'COLUMNS',
  'LINES',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE'
])

const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/i, reason: '禁止提权执行' },
  { pattern: /\b(chmod|chown)\s+777\b/i, reason: '禁止放宽全局权限' },
  { pattern: /\bcurl\b[^\n|]*\|\s*(ba)?sh\b/i, reason: '禁止 curl | sh 管道执行' },
  { pattern: /\bwget\b[^\n|]*\|\s*(ba)?sh\b/i, reason: '禁止 wget | sh 管道执行' },
  { pattern: /\b(npm|pnpm|yarn)\s+config\s+set\b[^\n]*(_auth|token|password)/i, reason: '禁止写入包管理器凭据' }
]

const STRICT_SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(?:^|[\s"'`])~\/\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker|kube)\b/i,
  /(?:^|[\s"'`])\/etc\/(?:passwd|shadow|sudoers)\b/i,
  /(?:^|[\s"'`])\/Users\/[^/\s"'`]+?\/\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker|kube)\b/i,
  /(?:^|[\s"'`])\/home\/[^/\s"'`]+?\/\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker|kube)\b/i,
  // Windows 形态：C:\Users\<name>\.ssh 及 %USERPROFILE%\.ssh
  /(?:^|[\s"'`])[a-z]:[\\/]users[\\/][^\\/\s"'`]+?[\\/]\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker|kube)\b/i,
  /%USERPROFILE%[\\/]\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker|kube)\b/i
]

export interface SanitizedProcessEnv {
  env: Record<string, string>
  removedKeys: string[]
}

export function sanitizeProcessEnv(
  source: NodeJS.ProcessEnv,
  workspaceRoot: string,
  strict = false
): SanitizedProcessEnv {
  const env: Record<string, string> = {}
  const removedKeys: string[] = []

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    // 严格模式：白名单之外一律丢弃（下方会重写 PATH/HOME/TMP 等基础项）。
    if (strict && !STRICT_ENV_ALLOWLIST.has(key.toUpperCase())) {
      removedKeys.push(key)
      continue
    }
    if (shouldStripEnvKey(key)) {
      removedKeys.push(key)
      continue
    }
    env[key] = value
  }

  env.PATH = normalizePathEnv(source.PATH)
  env.HOME = workspaceRoot
  env.TMPDIR = join(workspaceRoot, '.lucky', 'tmp')
  env.TEMP = env.TMPDIR
  env.TMP = env.TMPDIR
  env.LANG = env.LANG || env.LC_ALL || 'en_US.UTF-8'
  env.LC_ALL = env.LC_ALL || env.LANG
  env.TERM = env.TERM || 'xterm-256color'
  env.CI = env.CI || '1'
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'

  return { env, removedKeys }
}

export function assertSandboxCommandAllowed(command: string, strict: boolean): void {
  for (const { pattern, reason } of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`沙箱拒绝命令: ${reason}`)
    }
  }

  if (!strict) return

  const expanded = expandHomePaths(command)
  for (const pattern of STRICT_SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(expanded)) {
      throw new Error('严格沙箱禁止访问工作区外的敏感路径')
    }
  }
}

export function buildMacSeatbeltProfile(workspaceRoot: string, networkPolicy: 'deny' | 'allow'): string {
  const readableRoots = uniquePaths([
    workspaceRoot,
    '/usr',
    '/bin',
    '/sbin',
    '/opt/homebrew',
    '/Library/Developer',
    '/Applications/Xcode.app',
    '/System/Library',
    '/private/tmp',
    '/var/tmp',
    '/dev/null',
    '/dev/zero',
    '/dev/random',
    '/dev/urandom'
  ])

  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec*)',
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read-metadata)',
    ...(networkPolicy === 'allow' ? ['(allow network*)'] : ['(deny network*)']),
    ...readableRoots.flatMap((root) => [
      `(allow file-read* (subpath ${quoteSeatbeltPath(root)}))`
    ]),
    `(allow file-read* file-write* file-ioctl (subpath ${quoteSeatbeltPath(workspaceRoot)}))`,
    `(allow file-read* file-write* (subpath ${quoteSeatbeltPath(join(workspaceRoot, '.lucky', 'tmp'))}))`
  ]

  return `${lines.join('\n')}\n`
}

function shouldStripEnvKey(key: string): boolean {
  if (BLOCKED_ENV_KEYS.has(key)) return true
  const upper = key.toUpperCase()
  if (SECRET_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return true
  return SECRET_ENV_SUBSTRINGS.some((needle) => upper.includes(needle))
}

function normalizePathEnv(pathValue: string | undefined): string {
  const defaults =
    process.platform === 'win32'
      ? ['C:\\Windows\\system32', 'C:\\Windows']
      : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin']
  const parts = (pathValue ?? '').split(':').map((part) => part.trim()).filter(Boolean)
  const merged = [...new Set([...parts, ...defaults])]
  return merged.join(':')
}

function expandHomePaths(command: string): string {
  const home = homedir()
  return command.replace(/(^|[\s"'`])~(?=\/)/g, `$1${home}`)
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/\/+$/, '') || '/'))]
}

function quoteSeatbeltPath(path: string): string {
  return JSON.stringify(path)
}
