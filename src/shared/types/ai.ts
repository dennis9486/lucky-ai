export type AIProviderType = 'openai' | 'ollama' | 'lmstudio' | 'anthropic'

/**
 * 模型能力档案：实测探测结果（非按名字猜）。
 * errors 记录探测失败的明确原因（如 "该模型不支持 image_url 输入"）。
 */
export interface ModelCapabilityProfile {
  vision: boolean
  tools: boolean
  streaming: boolean
  jsonOutput: boolean
  /** 探测时间戳；存在即表示档案有效 */
  detectedAt: number
  /** 探测项 → 失败原因（探测通过的项不出现） */
  errors?: Record<string, string>
}

export interface AIModelConfig {
  id: string
  name: string
  enabled: boolean
  /** 多模态输入能力：auto=按模型名判断；on=明确支持；off=明确不支持。 */
  vision?: 'auto' | 'on' | 'off'
  /** 实测能力档案（优先级高于 vision 启发式） */
  capabilities?: ModelCapabilityProfile
}

export interface AIProviderConfig {
  id: string
  type: AIProviderType
  /** 展示与预设用的厂商标识；运行时协议仍由 type 决定。 */
  vendor?: string
  name: string
  baseUrl: string
  apiKey?: string
  /** 当前默认模型。兼容旧配置；运行时始终会解析为 activeModelId 对应的模型名。 */
  model: string
  models?: AIModelConfig[]
  activeModelId?: string
  enabled: boolean
}

/** 工具调用执行状态 */
export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'rejected'

/** 助手回合中的结构化片段 — 用于 Codex 风格的工具卡片渲染 */
export interface TextPart {
  type: 'text'
  text: string
}

export interface ThinkingPart {
  type: 'thinking'
  text: string
}

export interface ToolCallPart {
  type: 'tool'
  /** AgentScope tool_call_id，用于关联调用与结果 */
  id: string
  /** 工具名（Read / Write / Edit / Bash / Grep / Glob / MCP 工具名） */
  name: string
  /** 解析后的工具入参；流式期间可能为空 */
  input?: Record<string, unknown>
  /** 流式累积的原始入参 JSON（END 前尚未解析完成） */
  inputText?: string
  /** 工具输出（增量累积） */
  output: string
  status: ToolCallStatus
  /** 当前调用是对某次失败调用的恢复重试 */
  retryOf?: string
  /** 后续是否出现过恢复重试 */
  retryAttempted?: boolean
  /** 同一工具/同一入参的尝试序号，从 1 开始 */
  attempt?: number
  /** 工具失败的短摘要，供 UI 和恢复路径展示 */
  errorSummary?: string
  /** 面向用户/Agent 的下一步恢复建议 */
  recoverySuggestion?: string
}

export type MessagePart = TextPart | ThinkingPart | ToolCallPart

export interface AgentRunSummary {
  toolCount: number
  failedToolCount: number
  changedFiles: string[]
  verificationCommands: Array<{ command: string; status: ToolCallStatus }>
  failureReasons: string[]
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 结构化片段。存在时优先于 content 渲染（content 作为纯文本回退用于搜索/记忆） */
  parts?: MessagePart[]
  toolCallId?: string
  toolCalls?: Array<{ id: string; tool: string; args: Record<string, unknown> }>
  timestamp: number
  /** 流式生成中的消息；崩溃后可恢复为 incomplete */
  meta?: ChatMessageMeta
}

/** 用户消息附带的图片（多模态输入），用于在气泡里回显。 */
export interface ChatMessageImage {
  path: string
  name: string
  /** 当前会话即时预览地址；持久化后可缺省，缺省时用 path 回退。 */
  previewUrl?: string
}

export interface ChatMessageMeta {
  streaming?: boolean
  incomplete?: boolean
  runSummary?: AgentRunSummary
  /** 该消息附带的图片附件（多模态发送时记录，用于气泡回显与持久化）。 */
  images?: ChatMessageImage[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatCompletionRequest {
  messages: ChatMessage[]
  stream?: boolean
  maxTokens?: number
  temperature?: number
}

export interface ChatCompletionChunk {
  type: 'text' | 'tool_calls' | 'done' | 'error'
  content?: string
  toolCalls?: Array<{ id: string; tool: string; args: Record<string, unknown> }>
  error?: string
}

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'skipped'

export interface PlanStep {
  id: string
  text: string
  status: PlanStepStatus
}

export interface AgentPlan {
  id: string
  title: string
  steps: PlanStep[]
  status: 'pending' | 'approved' | 'rejected' | 'running' | 'done'
}

export interface AgentLoopState {
  status: 'idle' | 'running' | 'waiting_confirm' | 'stopped' | 'incomplete' | 'error' | 'done'
  currentStep: number
  maxSteps: number
  usage?: TokenUsage
  pendingToolCall?: import('./tool.js').ToolCall
}
