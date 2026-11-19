import { resolve, normalize, relative, isAbsolute, sep } from 'node:path'
import type {
  AgentPermissionPolicy,
  AgentPermissionRule,
  DangerLevel,
  ToolName,
  ToolPermissionCheck
} from '../../shared/types/tool.js'

/** 高危命令正则 — 匹配到需用户手动确认 */
const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[^\s]*r[^\s]*\s|-[^\s]*f|.*--recursive).*(?:\/|\*|$)/i, reason: '递归删除命令' },
  { pattern: /\brm\s+-rf\b/i, reason: 'rm -rf' },
  { pattern: /del\s+\/s/i, reason: 'del /s' },
  { pattern: /\bformat\b/i, reason: 'format 磁盘' },
  { pattern: /\bshutdown\b/i, reason: 'shutdown 系统' },
  { pattern: /curl\s+[^|]*\|\s*(ba)?sh/i, reason: 'curl | sh 管道执行' },
  { pattern: /wget\s+[^|]*\|\s*(ba)?sh/i, reason: 'wget | sh 管道执行' },
  { pattern: /\bsudo\b/i, reason: 'sudo 提权' },
  { pattern: /\bgit\s+reset\s+(--hard|--mixed|--merge|-[a-z]*h)/i, reason: 'git reset（可能丢弃未提交改动）' },
  { pattern: /\bgit\s+clean\s+(-[^\s]*f|.*--force)/i, reason: 'git clean（可能删除未跟踪文件）' },
  { pattern: /\bgit\s+push\b[^\n]*--force/i, reason: 'git push --force' },
  { pattern: /\bgit\s+push\b[^\n]*\s-f\b/i, reason: 'git push -f' },
  { pattern: /\bgit\s+checkout\s+--\s/i, reason: 'git checkout --（丢弃工作区改动）' },
  { pattern: /\bgit\s+restore\s+(-[^\s]*s|--source|--staged)/i, reason: 'git restore（可能丢弃改动）' }
]

/** 写操作类工具 — 需确认 */
const WRITE_TOOLS: ToolName[] = ['write_file', 'edit_file', 'apply_patch', 'run_command']

/** 只读工具 — 可自动批准 */
const READ_ONLY_TOOLS: ToolName[] = ['read_file', 'list_files', 'search_files', 'get_terminal_output', 'create_patch']

export class SecurityService {
  private workspaceRoot: string | null = null
  private permissionPolicy: AgentPermissionPolicy = { rules: [] }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = resolve(root)
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot
  }

  setPermissionPolicy(policy: AgentPermissionPolicy): void {
    this.permissionPolicy = { rules: policy.rules.filter((rule) => rule.enabled && rule.pattern.trim()) }
  }

  shouldConfirmAgentTool(toolName: string, fallback: boolean): boolean {
    const rule = this.matchRule('tool', toolName)
    if (rule?.action === 'allow') return false
    if (rule?.action === 'confirm' || rule?.action === 'block') return true
    return fallback
  }

  hasCommandConfirmRule(): boolean {
    return this.permissionPolicy.rules.some((rule) => rule.target === 'command' && rule.action === 'confirm')
  }

  assertAgentToolAllowed(toolName: string, args: Record<string, unknown>): void {
    const toolRule = this.matchRule('tool', toolName)
    if (toolRule?.action === 'block') {
      throw new Error(toolRule.note || `工具策略阻止: ${toolRule.pattern}`)
    }

    const pathValue = getToolPath(args)
    if (pathValue) {
      this.resolveSafePath(pathValue)
      const pathRule = this.matchRule('path', pathValue)
      if (pathRule?.action === 'block') {
        throw new Error(pathRule.note || `路径策略阻止: ${pathRule.pattern}`)
      }
    }

    if (toolName === 'Bash' && typeof args.command === 'string') {
      const check = this.checkCommand(args.command)
      if (check.dangerLevel === 'blocked') {
        throw new Error(check.reason ?? '命令被权限策略阻止')
      }
    }
  }

  /** 解析并校验路径，防止路径穿越 */
  resolveSafePath(inputPath: string): string {
    if (!this.workspaceRoot) {
      throw new Error('未打开工作区')
    }

    const root = this.workspaceRoot
    const resolved = isAbsolute(inputPath)
      ? normalize(inputPath)
      : normalize(resolve(root, inputPath))

    // 必须在工作区根目录内
    const rel = relative(root, resolved)
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      throw new Error(`路径越界: ${inputPath}`)
    }

    return resolved
  }

  /** 检查命令是否高危 */
  checkCommand(command: string): { dangerLevel: DangerLevel; reason?: string } {
    const rule = this.matchRule('command', command)
    if (rule) return this.ruleToDanger(rule, `命令策略: ${rule.pattern}`)

    for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        return { dangerLevel: 'confirm', reason }
      }
    }
    return { dangerLevel: 'none' }
  }

  /** 检查工具调用权限 */
  checkToolPermission(tool: ToolName, args: Record<string, unknown>, confirmed = false): ToolPermissionCheck {
    const toolRule = this.matchRule('tool', tool)
    const toolAllowed = toolRule?.action === 'allow'
    if (toolRule) {
      const check = this.ruleToPermission(toolRule, confirmed, `工具策略: ${toolRule.pattern}`)
      if (!check.allowed) return check
    }

    let pathAllowed = false
    const pathValue = getToolPath(args)
    if (pathValue) {
      try {
        this.resolveSafePath(pathValue)
      } catch (e) {
        return { allowed: false, dangerLevel: 'blocked', reason: String(e) }
      }
      const pathRule = this.matchRule('path', pathValue)
      pathAllowed = pathRule?.action === 'allow'
      if (pathRule) {
        const check = this.ruleToPermission(pathRule, confirmed, `路径策略: ${pathRule.pattern}`)
        if (!check.allowed) return check
      }
    }
    const policyAllowed = toolAllowed || pathAllowed
    let commandAllowed = false

    if (READ_ONLY_TOOLS.includes(tool)) {
      // 路径校验
      if ('path' in args && typeof args.path === 'string') {
        try {
          this.resolveSafePath(args.path)
        } catch (e) {
          return { allowed: false, dangerLevel: 'blocked', reason: String(e) }
        }
      }
      return { allowed: true, dangerLevel: 'none' }
    }

    if (WRITE_TOOLS.includes(tool)) {
      if ('path' in args && typeof args.path === 'string') {
        try {
          this.resolveSafePath(args.path)
        } catch (e) {
          return { allowed: false, dangerLevel: 'blocked', reason: String(e) }
        }
      }

      if (tool === 'run_command' && typeof args.command === 'string') {
        commandAllowed = this.matchRule('command', args.command)?.action === 'allow'
        const cmdCheck = this.checkCommand(args.command)
        if (cmdCheck.dangerLevel === 'blocked') {
          return { allowed: false, dangerLevel: 'blocked', reason: cmdCheck.reason }
        }
        if (cmdCheck.dangerLevel === 'confirm' && !confirmed) {
          return { allowed: false, dangerLevel: 'confirm', reason: cmdCheck.reason }
        }
      }

      if (!confirmed && !policyAllowed && !commandAllowed) {
        return { allowed: false, dangerLevel: 'confirm', reason: `${tool} 需要用户确认` }
      }

      return { allowed: true, dangerLevel: 'none' }
    }

    return { allowed: false, dangerLevel: 'blocked', reason: `未知工具: ${tool}` }
  }

  private matchRule(target: AgentPermissionRule['target'], value: string): AgentPermissionRule | undefined {
    return this.permissionPolicy.rules.find((rule) =>
      rule.target === target && wildcardMatch(rule.pattern, value)
    )
  }

  private ruleToDanger(rule: AgentPermissionRule, reason: string): { dangerLevel: DangerLevel; reason?: string } {
    if (rule.action === 'allow') return { dangerLevel: 'none' }
    return { dangerLevel: rule.action === 'block' ? 'blocked' : 'confirm', reason: rule.note || reason }
  }

  private ruleToPermission(
    rule: AgentPermissionRule,
    confirmed: boolean,
    reason: string
  ): ToolPermissionCheck {
    if (rule.action === 'allow') return { allowed: true, dangerLevel: 'none' }
    if (rule.action === 'block') return { allowed: false, dangerLevel: 'blocked', reason: rule.note || reason }
    if (!confirmed) return { allowed: false, dangerLevel: 'confirm', reason: rule.note || reason }
    return { allowed: true, dangerLevel: 'none' }
  }

  /** 脱敏日志 — 隐藏 apiKey */
  sanitizeForLog(text: string): string {
    return text.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***').replace(/api[_-]?key["':\s]+["']?[^"'\s]+/gi, 'apiKey=***')
  }
}

export const securityService = new SecurityService()

function getToolPath(args: Record<string, unknown>): string {
  for (const key of ['path', 'file_path', 'target_path', 'absolute_path']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function wildcardMatch(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim()
  if (!normalizedPattern) return false
  if (normalizedPattern === '*') return true
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(value)
}
