import type { AgentRunSummary, MessagePart } from './ai.js'

export type CodeAgentMode = 'agent' | 'plan' | 'debug' | 'multitask' | 'ask'
export type CodeAgentEffort = 'auto' | 'fast' | 'high'
export type CodeAgentPlanStatus = 'draft' | 'selected' | 'dismissed' | 'executed'

export interface CodeAgentPlanOption {
  id: string
  label: string
  title: string
  summary: string
  tradeoffs: string[]
  verification: string[]
  estimatedRisk: 'low' | 'medium' | 'high'
}

export interface CodeAgentPlanSet {
  id: string
  status: CodeAgentPlanStatus
  request: string
  options: CodeAgentPlanOption[]
  sourceTurnId?: string
  selectionMode?: 'single' | 'multiple'
  selectedOptionId?: string
  selectedOptionIds?: string[]
  createdAt: number
  updatedAt: number
}

export interface CodeAgentTurn {
  id: string
  userText: string
  parts: MessagePart[]
  createdAt: number
  streaming?: boolean
  incomplete?: boolean
  runSummary?: AgentRunSummary
  planRole?: 'proposal' | 'execution'
  planSet?: CodeAgentPlanSet
  /** 主进程本轮会话 id（= 文件前像 turn_id），用于按轮回滚文件修改 */
  agentSessionId?: string
}

export interface CodeAgentQueuedAttachment {
  path: string
  name: string
  kind: 'file' | 'folder' | 'image'
  mimeType?: string
  previewUrl?: string
}

export interface CodeAgentQueuedTurn {
  id: string
  text: string
  attachments?: CodeAgentQueuedAttachment[]
  createdAt: number
  updatedAt: number
}

export interface CodeAgentSession {
  id: string
  workspaceName?: string
  workspacePath?: string
  title: string
  titleSource: 'auto' | 'manual'
  conversationId: string
  turns: CodeAgentTurn[]
  queuedTurns?: CodeAgentQueuedTurn[]
  pendingPlan?: CodeAgentPlanSet
  /** 已处理的代码变更签名。用于刷新后仍隐藏已保留/已撤销的变更审查项。 */
  reviewedChangeSignatures?: string[]
  lastUserText: string
  createdAt: number
  updatedAt: number
  archived: boolean
  pinned: boolean
}

export interface PersistedCodeAgentState {
  activeSessionId: string
  activeSessionIdsByWorkspace?: Record<string, string>
  mode: CodeAgentMode
  effort: CodeAgentEffort
  sessions: CodeAgentSession[]
}
