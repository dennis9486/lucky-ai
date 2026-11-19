/** Agent 可调用的工具名称 */
export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'list_files'
  | 'search_files'
  | 'run_command'
  | 'get_terminal_output'
  | 'create_patch'
  | 'apply_patch'

export interface ToolCall {
  id: string
  tool: ToolName
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  tool: ToolName
  success: boolean
  output: string
  error?: string
}

/** 工具调用 JSON 格式（LLM 输出） */
export interface ToolCallPayload {
  tool: ToolName
  args: Record<string, unknown>
}

export interface ReadFileArgs {
  path: string
}

export interface WriteFileArgs {
  path: string
  content: string
}

export interface EditFileArgs {
  path: string
  oldText: string
  newText: string
}

export interface ListFilesArgs {
  path?: string
  recursive?: boolean
}

export interface SearchFilesArgs {
  query: string
  path?: string
}

export interface RunCommandArgs {
  command: string
  cwd?: string
}

export interface CreatePatchArgs {
  path: string
  patch: string
}

export interface ApplyPatchArgs {
  path: string
  patch: string
}

/** 需要用户确认的危险工具操作 */
export type DangerLevel = 'none' | 'confirm' | 'blocked'

export interface ToolPermissionCheck {
  allowed: boolean
  dangerLevel: DangerLevel
  reason?: string
}

export type AgentPermissionRuleTarget = 'tool' | 'path' | 'command'
export type AgentPermissionRuleAction = 'allow' | 'confirm' | 'block'

export interface AgentPermissionRule {
  id: string
  enabled: boolean
  target: AgentPermissionRuleTarget
  pattern: string
  action: AgentPermissionRuleAction
  note?: string
}

export interface AgentPermissionPolicy {
  rules: AgentPermissionRule[]
}
