/** AgentScope 事件 — 主进程 → 渲染进程 IPC 传输格式 */
export type AgentScopeEventType =
  | 'reply_start'
  | 'reply_end'
  | 'text_delta'
  | 'text_end'
  | 'thinking_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_result_start'
  | 'tool_result_delta'
  | 'tool_result_end'
  | 'require_confirm'
  | 'exceed_max_iters'
  | 'model_call_end'
  | 'error'

export interface AgentScopeToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AgentScopeEvent {
  type: AgentScopeEventType
  sessionId: string
  replyId?: string
  /** 流式文本 / 思考 / 工具入参 / 工具结果增量 */
  delta?: string
  /** 工具调用 id（贯穿 call/result 生命周期，用于 UI 关联） */
  toolCallId?: string
  /** 工具名（call_start / result_start 携带） */
  toolName?: string
  /** 工具结果终态：success / error / interrupted */
  state?: string
  /** 待确认工具调用信息 */
  toolCalls?: AgentScopeToolCallInfo[]
  /** Token 用量 */
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export interface AgentImageAttachment {
  path: string
  name: string
}

export type AgentMode = 'chat' | 'code'

export interface AgentConfirmRequest {
  sessionId: string
  replyId: string
  toolCallId: string
  confirmed: boolean
}

export interface AgentSendRequest {
  /** 渲染进程预生成的请求 id：作为事件通道键，确保订阅先于事件产生（消除竞态） */
  requestId?: string
  conversationId?: string
  message: string
  /** 附加上下文（项目结构、@file 引用等） */
  context?: string
  /** 图片附件。主进程会读取并转为模型可理解的多模态 data block。 */
  images?: AgentImageAttachment[]
  approvalMode?: import('./conversation.js').ApprovalMode
  /** Agent capability profile. Chat is general-purpose; Code is editor/workspace workflow focused. */
  agentMode?: AgentMode
}

export interface AgentTitleSummaryRequest {
  userMessage: string
  assistantText?: string
  workspaceName?: string
  locale?: string
}
