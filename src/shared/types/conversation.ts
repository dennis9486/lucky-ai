import type { ChatMessage } from './ai.js'
import type { ProjectEntry, StartupMode } from './project.js'

/** 会话摘要 — 侧边栏列表，不含消息体 */
export interface SessionSummary {
  id: string
  title: string
  workspaceName: string
  workspacePath?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  archivedAt?: number
}

/** 完整会话 — 含消息，按需加载 */
export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[]
}

export type ApprovalMode = 'ask' | 'auto' | 'full'

/** 应用级 UI 偏好（项目/会话选中态等） */
export interface ConversationState {
  activeSessionId: string | null
  activeProjectId: string | null
  startupMode: StartupMode
  approvalMode: ApprovalMode
}

export interface CreateSessionInput {
  id?: string
  title: string
  workspaceName: string
  workspacePath?: string
  createdAt?: number
  updatedAt?: number
}

export interface UpdateSessionInput {
  title?: string
  workspaceName?: string
  workspacePath?: string | null
  updatedAt?: number
  archivedAt?: number | null
}

export interface SessionListOptions {
  includeArchived?: boolean
  query?: string
}

/** 一次性从 localStorage 迁移的数据包 */
export interface LegacyConversationImport {
  sessions?: Array<{
    id: string
    title: string
    workspaceName: string
    workspacePath?: string
    messages: ChatMessage[]
    createdAt: number
    updatedAt: number
  }>
  activeSessionId?: string | null
  projects?: ProjectEntry[]
  activeProjectId?: string | null
  startupMode?: StartupMode
  approvalMode?: ApprovalMode
}

export interface LegacyImportResult {
  imported: boolean
  sessionCount: number
  projectCount: number
}
