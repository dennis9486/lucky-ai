import type { AIProviderConfig, ChatCompletionRequest, ChatCompletionChunk } from './ai.js'
import type {
  EditorWorkspaceState,
  FileContentReplaceOptions,
  FileContentReplaceResult,
  FileContentSearchOptions,
  FileContentSearchResult,
  FileTreeNode,
  FileSearchResult,
  WorkspaceGitCommitResult,
  WorkspaceGitStashEntry,
  WorkspaceGitFileDiff,
  WorkspaceGitFileHunks,
  WorkspaceGitReviewResult,
  WorkspaceGitBranch,
  WorkspaceGitStatus,
  WorkspaceInfo
} from './workspace.js'
import type { AgentPermissionPolicy } from './tool.js'
import type { ThemeSettings } from './theme.js'
import type { AgentMemory, MemoryCreateInput, MemoryListOptions, PersonalizationSettings } from './personalization.js'
import type { MemoryCaptureRequest } from './personalization.js'
import type { AppLocale } from './locale.js'
import type { AgentSandboxMode } from './sandbox.js'
import type { AgentUsageSummary } from './usage.js'
import type { BrowserSearchEngine } from './browser.js'
import type { KeyboardShortcutSettings } from './shortcuts.js'
import type {
  CreateScheduledTaskInput,
  MarkScheduledTaskRunInput,
  ScheduledTask,
  ScheduledTaskFiredEvent,
  ScheduledTaskListOptions,
  ScheduledTaskRun,
  ScheduledTaskTemplate,
  UpdateScheduledTaskInput
} from './scheduled-task.js'

export type {
  EditorWorkspaceState,
  CreateScheduledTaskInput,
  MarkScheduledTaskRunInput,
  ScheduledTask,
  ScheduledTaskFiredEvent,
  ScheduledTaskListOptions,
  ScheduledTaskRun,
  ScheduledTaskTemplate,
  UpdateScheduledTaskInput
}

export interface IpcResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

export interface FileReadResult {
  path: string
  content: string
  truncated: boolean
  summary?: string
}

export interface TerminalCreateResult {
  id: string
}

export interface TerminalOutputResult {
  id: string
  output: string
}

export interface RunCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  blocked?: boolean
  needsConfirm?: boolean
}

export interface AgentMcpServerConfig {
  id: string
  name: string
  enabled: boolean
  type: 'stdio' | 'http'
  requireUserConfirm: boolean
  enabledTools?: string[]
  disabledTools?: string[]
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  transportType?: 'streamable-http' | 'sse'
  stateful?: boolean
  bearerTokenEnv?: string
  headers?: Record<string, string>
  headerEnv?: Record<string, string>
  envForward?: string[]
  source?: 'user' | 'plugin'
}

export interface McpServerTestResult {
  serverId: string
  ok: boolean
  tools: Array<{ name: string; description: string }>
  error?: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

export interface ProviderModelListResult {
  models: string[]
}

/** Agent 某轮捕获的单个文件前像摘要 */
export interface AgentTurnCheckpointFile {
  /** 文件绝对路径 */
  path: string
  /** 该轮修改前文件是否已存在（false = 该轮新建，回滚即删除） */
  existedBefore: boolean
  /** 前像字节数 */
  bytes: number
}

/** 按轮回滚 Agent 文件修改的执行结果 */
export interface AgentTurnRevertResult {
  /** 已恢复为前像内容的文件 */
  restored: string[]
  /** 该轮新建、回滚时被删除的文件 */
  deleted: string[]
  /** 跳过的文件及原因（如已不在当前工作区内） */
  skipped: Array<{ path: string; reason: string }>
}

export interface PastedImageInput {
  data: ArrayBuffer
  mimeType: string
  name?: string
}

export interface SavedAttachment {
  path: string
  name: string
  kind: 'file' | 'folder' | 'image'
  mimeType?: string
}

export interface SaveTextFileInput {
  defaultPath: string
  content: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface AIInlineCompletionStats {
  requested: number
  shown: number
  accepted: number
  dismissed: number
  canceled: number
  lastAcceptedAt?: number
}

export interface AIInlineCompletionRequest {
  requestId: string
  filePath: string
  languageId: string
  beforeCursor: string
  afterCursor: string
  linePrefix: string
  lineSuffix: string
  triggerKind?: 'automatic' | 'explicit'
  maxLines?: number
}

export interface AIInlineCompletionResult {
  requestId: string
  insertText: string
}

export interface AIInlineEditRequest {
  requestId: string
  filePath: string
  languageId: string
  instruction: string
  selectedText: string
  beforeSelection: string
  afterSelection: string
  previousReplacement?: string
}

export interface AIInlineEditResult {
  requestId: string
  replacement: string
}

export interface EditorSettings {
  fileOpenTarget: 'builtin' | 'vscode'
  formatOnSave: boolean
  formatOnPaste: boolean
  defaultFormatter: 'auto' | 'prettier' | 'eslint' | 'lsp'
  inlineSuggest: boolean
  aiInlineCompletions: boolean
  aiInlineCompletionStats: AIInlineCompletionStats
  monacoThemeLight?: string
  monacoThemeDark?: string
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fileOpenTarget: 'builtin',
  formatOnSave: true,
  formatOnPaste: false,
  defaultFormatter: 'auto',
  inlineSuggest: true,
  aiInlineCompletions: true,
  aiInlineCompletionStats: {
    requested: 0,
    shown: 0,
    accepted: 0,
    dismissed: 0,
    canceled: 0
  },
  monacoThemeLight: 'github-light',
  monacoThemeDark: 'github-dark'
}

export interface AppShellSettings {
  showInMenuBar: boolean
  showBottomPanel: boolean
  defaultTerminalLocation: 'bottom' | 'right'
  popupShortcutEnabled: boolean
  defaultNoProjectChat: boolean
}

export interface AgentRunSettings {
  preventSleepWhileRunning: boolean
  runSpeed: 'fast' | 'balanced' | 'careful'
  codeReviewView: 'inline' | 'separate'
  /** Isolated shell execution profile for agent Bash and run_command. */
  agentSandbox: AgentSandboxMode
  /** Prefer running agent Bash inside a Docker container when available (stronger, reproducible isolation). */
  agentSandboxContainer: boolean
  /** Docker image used when agentSandboxContainer is on. */
  agentSandboxImage: string
}

export interface InputSettings {
  sendShortcut: 'enter' | 'mod-enter'
  followupBehavior: 'queue' | 'quote'
}

export interface BrowserGeneralSettings {
  browserHomepage: string
  browserSearchEngine: BrowserSearchEngine
}

export interface DictationSettings {
  microphone: 'system' | 'off'
  holdToDictateShortcut: 'off' | 'space' | 'fn'
  toggleDictationShortcut: 'off' | 'space' | 'fn'
  keepDictationVisible: boolean
  dictationDictionary: string
}

export interface NotificationSettings {
  completionNotification: 'focused' | 'always' | 'never'
  permissionNotifications: boolean
  issueNotifications: boolean
}

export interface GeneralAppSettings
  extends AppShellSettings,
    AgentRunSettings,
    InputSettings,
    BrowserGeneralSettings,
    DictationSettings,
    NotificationSettings {}

export const DEFAULT_GENERAL_APP_SETTINGS: GeneralAppSettings = {
  showInMenuBar: true,
  showBottomPanel: true,
  defaultTerminalLocation: 'bottom',
  preventSleepWhileRunning: false,
  runSpeed: 'fast',
  codeReviewView: 'inline',
  sendShortcut: 'enter',
  followupBehavior: 'queue',
  popupShortcutEnabled: false,
  defaultNoProjectChat: false,
  browserHomepage: '',
  browserSearchEngine: 'duckduckgo',
  microphone: 'system',
  holdToDictateShortcut: 'off',
  toggleDictationShortcut: 'off',
  keepDictationVisible: false,
  dictationDictionary: '',
  completionNotification: 'focused',
  permissionNotifications: true,
  issueNotifications: true,
  agentSandbox: 'balanced',
  agentSandboxContainer: false,
  agentSandboxImage: 'node:20-alpine'
}

export interface SettingsData {
  activeProviderId: string
  providers: AIProviderConfig[]
  maxAgentSteps: number
  maxContextTokens: number
  professionalMode: boolean
  agentScopeFullPower: boolean
  autoApproveReadOnly: boolean
  /** 遮罩 Agent 工具输出与注入上下文中的敏感凭证（默认开启） */
  redactSecretsInContext: boolean
  permissionPolicy: AgentPermissionPolicy
  agentSystemPrompt: string
  skillPaths: string[]
  skillDirPaths: string[]
  mcpServers: AgentMcpServerConfig[]
  theme: ThemeSettings
  personalization: PersonalizationSettings
  locale: AppLocale
  editor?: EditorSettings
  general: GeneralAppSettings
  keyboardShortcuts: KeyboardShortcutSettings
}

export interface FormatFileRequest {
  path: string
  content: string
  workspaceRoot: string
  preferredFormatter?: EditorSettings['defaultFormatter']
}

export interface FormatFileResult {
  content: string
  formatter: 'prettier' | 'eslint' | 'lsp' | 'none'
  error?: string
}

export type { AgentMemory, MemoryCaptureRequest, MemoryCreateInput, MemoryListOptions }

export type {
  AIProviderConfig,
  ChatCompletionRequest,
  ChatCompletionChunk,
  FileTreeNode,
  FileContentSearchOptions,
  FileContentSearchResult,
  FileContentReplaceOptions,
  FileContentReplaceResult,
  FileSearchResult,
  WorkspaceGitCommitResult,
  WorkspaceGitStashEntry,
  WorkspaceGitFileDiff,
  WorkspaceGitFileHunks,
  WorkspaceGitReviewResult,
  WorkspaceGitBranch,
  WorkspaceGitStatus,
  WorkspaceInfo,
  AgentUsageSummary
}
