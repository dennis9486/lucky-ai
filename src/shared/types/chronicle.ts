export interface ChronicleThread {
  sessionId: string
  title: string
  lastUserMessage: string
  lastAssistantSnippet: string
  updatedAt: number
  workspacePath?: string
}

export interface ChronicleSnapshot {
  threads: ChronicleThread[]
  memories: string[]
  workspaceSummary?: string
  generatedAt: number
}
