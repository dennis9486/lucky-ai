import type { DiffLine } from '../../../utils/tool-display.js'
import type { ToolCallPart, ToolCallStatus } from '../../../../shared/types/ai.js'

export interface AgentReportStats {
  files: number
  searches: number
  fetches: number
  commands: number
  edits: number
  failed: number
}

export interface AgentReportPatch {
  id: string
  path: string
  name: string
  additions: number
  deletions: number
  status: ToolCallStatus
  lines: DiffLine[]
  tools: ToolCallPart[]
}

export interface AgentReportArtifact {
  id: string
  title: string
  subtitle?: string
  path?: string
}
