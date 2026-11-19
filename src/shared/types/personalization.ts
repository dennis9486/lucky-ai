export type PersonalityTone = 'amiable' | 'professional' | 'concise' | 'detailed' | 'creative'
export type MemoryAutoCaptureMode = 'off' | 'explicit' | 'balanced' | 'aggressive'
export type MemoryDefaultScope = 'global' | 'workspace'

export interface PersonalizationSettings {
  personality: PersonalityTone
  memoryEnabled: boolean
  chroniclePreview: boolean
  skipToolAssistedMemory: boolean
  memoryAutoCapture: MemoryAutoCaptureMode
  memoryDefaultScope: MemoryDefaultScope
  memoryIncludeGlobal: boolean
  memoryPromptLimit: number
  memoryMinConfidence: number
  memoryRetentionDays: number
}

export interface AgentMemory {
  id: string
  kind: 'preference' | 'fact' | 'project' | 'workflow' | 'decision' | 'summary' | 'instruction'
  scope: 'global' | 'workspace' | 'project' | 'session'
  title: string
  content: string
  summary: string
  tags: string[]
  workspacePath?: string
  projectId?: string
  sessionId?: string
  sourceMessageId?: string
  sourceType: 'manual' | 'chat' | 'project_file' | 'import' | 'system'
  sourceUrl?: string
  sourceExcerpt: string
  confidence: number
  importance: number
  status: 'active' | 'archived' | 'deleted'
  pinned: boolean
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  expiresAt?: number
  archivedAt?: number
  metadata?: AgentMemoryMetadata
}

export interface AgentMemoryMetadata {
  canonicalKey?: string
  lifecycle?: 'current' | 'historical' | 'deprecated'
  supersedesIds?: string[]
  supersededById?: string
  deprecatedAt?: number
  lineageReason?: string
  structuredFact?: AgentMemoryStructuredFact
  previousValues?: AgentMemoryFactValue[]
}

export interface AgentMemoryStructuredFact {
  namespace: 'personal' | 'project' | 'preference' | 'workflow' | 'decision' | 'constraint' | 'general'
  subject: string
  relation: string
  value: string
  canonicalKey: string
  evidence: string
  validFrom?: number
  validTo?: number
}

export interface AgentMemoryFactValue {
  value: string
  memoryId?: string
  validFrom?: number
  validTo?: number
  evidence?: string
}

export interface MemoryListOptions {
  query?: string
  workspacePath?: string
  includeGlobal?: boolean
  includeArchived?: boolean
  minConfidence?: number
  limit?: number
}

export interface MemoryCreateInput {
  kind?: AgentMemory['kind']
  scope?: AgentMemory['scope']
  title?: string
  content: string
  summary?: string
  tags?: string[]
  workspacePath?: string
  projectId?: string
  sessionId?: string
  sourceMessageId?: string
  sourceType?: AgentMemory['sourceType']
  sourceUrl?: string
  sourceExcerpt?: string
  confidence?: number
  importance?: number
  pinned?: boolean
  expiresAt?: number
}

export interface MemoryCaptureRequest {
  sessionId: string
  workspacePath?: string
  userMessage: string
  assistantMessage: string
  usedTools: boolean
}

export const PERSONALITY_LABELS: Record<PersonalityTone, string> = {
  amiable: '亲和',
  professional: '专业',
  concise: '简洁',
  detailed: '详尽',
  creative: '创意'
}

export const PERSONALITY_PROMPTS: Record<PersonalityTone, string> = {
  amiable: '回复语气亲和、友好，像一位耐心的同事。',
  professional: '回复语气专业、严谨，注重准确性和结构。',
  concise: '回复简洁直接，避免冗余，优先给出可执行结论。',
  detailed: '回复详尽全面，解释推理过程与权衡取舍。',
  creative: '回复富有创意，善于提出多种方案与新颖思路。'
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  personality: 'amiable',
  memoryEnabled: true,
  chroniclePreview: false,
  skipToolAssistedMemory: false,
  memoryAutoCapture: 'balanced',
  memoryDefaultScope: 'workspace',
  memoryIncludeGlobal: true,
  memoryPromptLimit: 8,
  memoryMinConfidence: 0.55,
  memoryRetentionDays: 0
}

export const MAX_AGENT_MEMORIES = 50
