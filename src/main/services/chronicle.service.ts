import { memoryService } from './memory.service.js'
import { conversationService } from './conversation.service.js'
import { workspaceService } from './workspace.service.js'
import type { ChronicleSnapshot, ChronicleThread } from '../../shared/types/chronicle.js'

const MAX_THREADS = 5
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function extractLastMessages(messages: Array<{ role: string; content: string }>): {
  lastUser: string
  lastAssistant: string
} {
  let lastUser = ''
  let lastAssistant = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (!lastAssistant && msg.role === 'assistant' && msg.content.trim()) {
      lastAssistant = truncate(msg.content, 200)
    }
    if (!lastUser && msg.role === 'user' && msg.content.trim()) {
      lastUser = truncate(msg.content, 160)
    }
    if (lastUser && lastAssistant) break
  }
  return { lastUser, lastAssistant }
}

function looksOpen(lastUser: string, lastAssistant: string): boolean {
  if (!lastUser) return false
  const completionHints = /(?:已完成|完成总结|done|finished|已全部|搞定)/i
  if (completionHints.test(lastAssistant)) return false
  const followUpHints = /(?:继续|下一步|待办|TODO|未完成|还需要|请确认)/i
  return followUpHints.test(lastUser) || followUpHints.test(lastAssistant) || !lastAssistant
}

export class ChronicleService {
  async buildSnapshot(excludeSessionId?: string): Promise<ChronicleSnapshot> {
    const now = Date.now()
    const sessions = conversationService
      .listSessionSummaries()
      .filter((s) => s.id !== excludeSessionId && now - s.updatedAt < MAX_AGE_MS)
      .slice(0, MAX_THREADS + 3)

    const threads: ChronicleThread[] = []

    for (const summary of sessions) {
      if (threads.length >= MAX_THREADS) break
      const detail = conversationService.getSessionDetail(summary.id)
      if (!detail?.messages.length) continue

      const { lastUser, lastAssistant } = extractLastMessages(detail.messages)
      if (!looksOpen(lastUser, lastAssistant)) continue

      threads.push({
        sessionId: summary.id,
        title: summary.title,
        lastUserMessage: lastUser,
        lastAssistantSnippet: lastAssistant,
        updatedAt: summary.updatedAt,
        workspacePath: summary.workspacePath
      })
    }

    const memories = (await memoryService.list({ limit: 8 })).map((m) => m.content)

    const ws = workspaceService.getWorkspace()
    const workspaceSummary = ws
      ? `当前工作区: ${ws.name} (${ws.rootPath})`
      : undefined

    return {
      threads,
      memories,
      workspaceSummary,
      generatedAt: now
    }
  }

  formatForPrompt(snapshot: ChronicleSnapshot): string {
    const sections: string[] = []

    if (snapshot.workspaceSummary) {
      sections.push(`### 工作区\n${snapshot.workspaceSummary}`)
    }

    if (snapshot.threads.length) {
      const lines = snapshot.threads.map(
        (t, i) =>
          `${i + 1}. **${t.title}** (${new Date(t.updatedAt).toLocaleDateString('zh-CN')})\n` +
          `   - 用户: ${t.lastUserMessage || '—'}\n` +
          `   - 助手: ${t.lastAssistantSnippet || '—'}`
      )
      sections.push(`### 未完成任务线索\n${lines.join('\n')}`)
    }

    if (snapshot.memories.length) {
      sections.push(`### 相关记忆\n${snapshot.memories.map((m) => `- ${m}`).join('\n')}`)
    }

    if (!sections.length) {
      return 'Chronicle 预览：暂无可用历史线索，请基于当前对话与工作区上下文作答。'
    }

    return `Chronicle 预览（基于近期会话与记忆，优先延续未完成任务）:\n\n${sections.join('\n\n')}`
  }
}

export const chronicleService = new ChronicleService()
