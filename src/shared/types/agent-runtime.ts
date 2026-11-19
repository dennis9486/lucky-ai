export type AgentRuntimeState = 'idle' | 'processing' | 'maintenance' | 'paused' | 'error'

export type AgentRuntimeEventSource = 'user' | 'chat' | 'task' | 'reminder' | 'browser' | 'system' | 'background'

export type AgentRuntimeEventStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export type AgentRuntimeIntentKind =
  | 'chat'
  | 'code'
  | 'browser'
  | 'scheduled_task'
  | 'memory'
  | 'file'
  | 'search'
  | 'image'
  | 'diagnostics'
  | 'tool_discovery'

export interface AgentRuntimeIntent {
  primary: AgentRuntimeIntentKind
  confidence: number
  signals: string[]
  language: 'zh' | 'en' | 'mixed' | 'unknown'
}

export interface AgentRuntimeQueueInput {
  source: AgentRuntimeEventSource
  title: string
  detail?: string
  priority?: number
  metadata?: Record<string, unknown>
}

export interface AgentRuntimeQueueUpdateInput {
  id: string
  status: AgentRuntimeEventStatus
  detail?: string
  metadata?: Record<string, unknown>
}

export interface AgentRuntimeQueueItem extends Required<AgentRuntimeQueueInput> {
  id: string
  status: AgentRuntimeEventStatus
  createdAt: number
  updatedAt: number
}

export interface AgentRuntimeTrace {
  id: string
  turnId: string
  phase: 'intent' | 'context' | 'plan' | 'execute' | 'verify' | 'tool' | 'action' | 'error'
  title: string
  detail: Record<string, unknown>
  createdAt: number
}

export interface AgentRuntimeContextAudit {
  id: string
  turnId: string
  intent: AgentRuntimeIntent
  budgetChars: number
  usedChars: number
  selected: string[]
  skipped: string[]
  createdAt: number
}

export interface AgentRuntimeToolRegistryItem {
  id: string
  name: string
  description: string
  intents: AgentRuntimeIntentKind[]
  risk: 'low' | 'medium' | 'high'
  enabled: boolean
  requiresConfirmation: boolean
}

export interface AgentRuntimeContextBuildInput {
  text: string
  sessionId?: string
  workspacePath?: string
  maxChars?: number
  source?: AgentRuntimeEventSource
  /** 与 Agent run 的 requestId 对齐，便于观测链路关联 */
  turnId?: string
}

export type AgentRuntimeContextSourceKind =
  | 'user'
  | 'system'
  | 'workspace'
  | 'memory'
  | 'tasks'
  | 'browser'
  | 'tools'
  | 'attachments'
  | 'references'

export interface AgentRuntimeContextSource {
  id: string
  label: string
  kind: AgentRuntimeContextSourceKind
  chars: number
  budgetChars: number
  status: 'selected' | 'skipped' | 'truncated' | 'error'
  reason?: string
}

export interface AgentRuntimeContextManifest {
  id: string
  turnId: string
  source: AgentRuntimeEventSource
  intent: AgentRuntimeIntent
  budgetChars: number
  usedChars: number
  sources: AgentRuntimeContextSource[]
  tools: AgentRuntimeToolRegistryItem[]
  createdAt: number
}

export interface AgentRuntimeContextBuildResult {
  turnId: string
  intent: AgentRuntimeIntent
  text: string
  selected: string[]
  skipped: string[]
  usedChars: number
  budgetChars: number
  tools: AgentRuntimeToolRegistryItem[]
  manifest: AgentRuntimeContextManifest
}

export interface AgentRuntimeSnapshot {
  state: AgentRuntimeState
  lastTickAt: number | null
  queue: AgentRuntimeQueueItem[]
  recentEvents: AgentRuntimeQueueItem[]
  traces: AgentRuntimeTrace[]
  audits: AgentRuntimeContextAudit[]
  manifests: AgentRuntimeContextManifest[]
  tools: AgentRuntimeToolRegistryItem[]
  stats: {
    queued: number
    running: number
    doneToday: number
    failedToday: number
  }
  error?: string
}
