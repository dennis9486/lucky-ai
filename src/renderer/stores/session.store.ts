import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ChatMessage } from '../../shared/types/ai.js'
import type { SessionSummary, UpdateSessionInput } from '../../shared/types/conversation.js'
import type { ChatSession, SidebarProjectGroup } from '../../shared/types/session.js'
import { conversation } from '../services/conversation-client.js'
import { formatTimeAgo } from '../utils/time.js'
import { normalizeGeneratedTitleText } from '../utils/title.js'
import { sessionDefaultTitle, tGlobal } from '../i18n/index.js'
import { useProjectStore } from './project.store.js'

const MAX_TITLE_LENGTH = 40
const RECENT_SHORTCUT_LIMIT = 5
const DEFAULT_TITLES = new Set(['新对话', 'New chat'])

function compactText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function partTextSignature(message: ChatMessage): string {
  const parts = message.parts ?? []
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return compactText(text || message.content)
}

function fullMessageSignature(message: ChatMessage): string {
  return JSON.stringify({
    role: message.role,
    content: compactText(message.content),
    parts: message.parts ?? null,
    toolCallId: message.toolCallId ?? null
  })
}

function hasToolParts(message: ChatMessage): boolean {
  return Boolean(message.parts?.some((part) => part.type === 'tool'))
}

function isDuplicateAssistantMessage(prev: ChatMessage | undefined, next: ChatMessage): boolean {
  if (!prev) return false
  if (prev.id === next.id) return true
  if (prev.role !== 'assistant' || next.role !== 'assistant') return false
  if (fullMessageSignature(prev) === fullMessageSignature(next)) return true
  if (hasToolParts(prev) || hasToolParts(next)) return false
  const prevText = partTextSignature(prev)
  const nextText = partTextSignature(next)
  return Boolean(prevText && prevText === nextText)
}

function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of messages) {
    if (seenIds.has(message.id)) continue
    const previous = result[result.length - 1]
    if (isDuplicateAssistantMessage(previous, message)) continue
    seenIds.add(message.id)
    result.push(message)
  }

  return result
}

function getWorkspaceMeta(): { name: string; path?: string } {
  const project = useProjectStore()
  return {
    name: project.activeProject?.name ?? tGlobal('session.noProject'),
    path: project.activeProject?.rootPath
  }
}

function makeTitle(text: string): string {
  const trimmed = normalizeGeneratedTitleText(text)
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_TITLE_LENGTH)}…`
}

function groupSessions(summaries: SessionSummary[]): SidebarProjectGroup[] {
  const sorted = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
  const groups = new Map<string, SidebarProjectGroup>()

  for (const session of sorted) {
    const key = session.workspacePath ?? session.workspaceName
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: session.workspaceName,
        workspacePath: session.workspacePath ?? null,
        items: []
      })
    }
    groups.get(key)!.items.push({
      id: session.id,
      title: session.title,
      timeAgo: formatTimeAgo(session.updatedAt),
      archived: Boolean(session.archivedAt)
    })
  }

  const result = Array.from(groups.values())
  if (result[0]) {
    result[0].items = result[0].items.map((item, index) => {
      if (index < RECENT_SHORTCUT_LIMIT) {
        return { ...item, shortcut: `⌘${index + 1}` }
      }
      return item
    })
  }
  return result
}

export const useSessionStore = defineStore('session', () => {
  const summaries = ref<SessionSummary[]>([])
  const activeSessionId = ref<string | null>(null)
  const messageCache = ref<Map<string, ChatMessage[]>>(new Map())
  const loaded = ref(false)
  const showArchived = ref(false)

  const activeSession = computed<ChatSession | null>(() => {
    const summary = summaries.value.find((s) => s.id === activeSessionId.value)
    if (!summary) return null
    const messages = dedupeMessages(messageCache.value.get(summary.id) ?? [])
    return { ...summary, messages }
  })

  const projectGroups = computed(() => groupSessions(summaries.value))
  const primaryGroupSize = computed(() => projectGroups.value[0]?.items.length ?? 0)

  async function persistActiveSession(): Promise<void> {
    await conversation.setState({ activeSessionId: activeSessionId.value })
  }

  async function loadSessionMessages(id: string): Promise<ChatMessage[]> {
    if (messageCache.value.has(id)) {
      return messageCache.value.get(id)!
    }
    await conversation.recoverStreaming(id)
    const detail = await conversation.getSession(id)
    const messages = dedupeMessages(detail?.messages ?? [])
    messageCache.value.set(id, messages)
    return messages
  }

  async function refreshList(): Promise<void> {
    summaries.value = await conversation.listSessions({ includeArchived: showArchived.value })
  }

  function upsertSummary(summary: SessionSummary): void {
    const idx = summaries.value.findIndex((s) => s.id === summary.id)
    if (idx >= 0) {
      summaries.value[idx] = summary
    } else if (showArchived.value || !summary.archivedAt) {
      summaries.value.unshift(summary)
    }
  }

  async function load(): Promise<void> {
    if (loaded.value) return
    const [list, state] = await Promise.all([
      conversation.listSessions({ includeArchived: showArchived.value }),
      conversation.getState()
    ])
    summaries.value = list
    activeSessionId.value = state.activeSessionId
    if (state.activeSessionId) {
      await loadSessionMessages(state.activeSessionId)
    }
    loaded.value = true
  }

  async function toggleShowArchived(): Promise<void> {
    showArchived.value = !showArchived.value
    await refreshList()
  }

  async function searchSessions(query: string): Promise<SessionSummary[]> {
    if (!query.trim()) return []
    return conversation.searchSessions(query)
  }

  async function createSession(firstMessage?: string): Promise<ChatSession> {
    const { name, path } = getWorkspaceMeta()
    const defaultTitle = sessionDefaultTitle()
    const summary = await conversation.createSession({
      title: firstMessage ? makeTitle(firstMessage) : defaultTitle,
      workspaceName: name,
      workspacePath: path
    })
    summaries.value.unshift(summary)
    messageCache.value.set(summary.id, [])
    activeSessionId.value = summary.id
    await persistActiveSession()
    return { ...summary, messages: [] }
  }

  async function createSessionWithTitle(title: string): Promise<ChatSession> {
    const { name, path } = getWorkspaceMeta()
    const defaultTitle = sessionDefaultTitle()
    const explicitTitle = normalizeGeneratedTitleText(title) || defaultTitle
    const summary = await conversation.createSession({
      title: explicitTitle,
      workspaceName: name,
      workspacePath: path
    })
    summaries.value.unshift(summary)
    messageCache.value.set(summary.id, [])
    activeSessionId.value = summary.id
    await persistActiveSession()
    return { ...summary, messages: [] }
  }

  async function selectSession(id: string): Promise<ChatSession | null> {
    const summary = summaries.value.find((s) => s.id === id)
    if (!summary) return null
    activeSessionId.value = id
    await loadSessionMessages(id)
    await persistActiveSession()
    return activeSession.value
  }

  async function selectSessionWithProject(id: string): Promise<ChatSession | null> {
    const session = await selectSession(id)
    if (!session) return null
    if (session.workspacePath) {
      await useProjectStore().activateByPath(session.workspacePath)
    }
    return session
  }

  async function newChat(): Promise<void> {
    const current = activeSession.value
    if (current && current.messages.length === 0) {
      await conversation.deleteSession(current.id)
      summaries.value = summaries.value.filter((s) => s.id !== current.id)
      messageCache.value.delete(current.id)
    }
    activeSessionId.value = null
    await persistActiveSession()
  }

  async function ensureActiveSession(firstMessage?: string): Promise<ChatSession> {
    if (activeSession.value) return activeSession.value
    return createSession(firstMessage)
  }

  async function updateSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const nextMessages = dedupeMessages(messages)
    messageCache.value.set(sessionId, nextMessages)
    await conversation.replaceMessages(sessionId, nextMessages)
    const idx = summaries.value.findIndex((s) => s.id === sessionId)
    const current = summaries.value[idx]
    if (current) {
      summaries.value[idx] = {
        ...current,
        updatedAt: Date.now(),
        messageCount: nextMessages.length
      }
    }
  }

  async function appendMessageToSession(sessionId: string, message: ChatMessage): Promise<void> {
    const current = await loadSessionMessages(sessionId)
    const next = dedupeMessages([...current, message])
    await updateSessionMessages(sessionId, next)
  }

  async function upsertMessageToSession(sessionId: string, message: ChatMessage): Promise<void> {
    await conversation.upsertMessage(sessionId, message)
    const current = messageCache.value.get(sessionId) ?? await loadSessionMessages(sessionId)
    const index = current.findIndex((item) => item.id === message.id)
    const next = index >= 0
      ? current.map((item, i) => (i === index ? message : item))
      : dedupeMessages([...current, message])
    messageCache.value.set(sessionId, dedupeMessages(next))
    const summaryIdx = summaries.value.findIndex((s) => s.id === sessionId)
    const summary = summaries.value[summaryIdx]
    if (summary) {
      summaries.value[summaryIdx] = {
        ...summary,
        updatedAt: Date.now(),
        messageCount: next.length
      }
    }
  }

  async function touchSession(sessionId: string, title?: string): Promise<void> {
    const summary = summaries.value.find((s) => s.id === sessionId)
    if (!summary) return

    const input: UpdateSessionInput = { updatedAt: Date.now() }
    if (title && DEFAULT_TITLES.has(summary.title)) {
      input.title = makeTitle(title)
    }

    const updated = await conversation.updateSession(sessionId, input)
    if (updated) {
      const idx = summaries.value.findIndex((s) => s.id === sessionId)
      if (idx >= 0) summaries.value[idx] = updated
    }
  }

  function canApplyAutoTitle(sessionId: string): boolean {
    const summary = summaries.value.find((s) => s.id === sessionId)
    return Boolean(summary && DEFAULT_TITLES.has(summary.title))
  }

  async function applyAutoTitle(sessionId: string, title: string): Promise<void> {
    if (!canApplyAutoTitle(sessionId)) return
    const nextTitle = makeTitle(title)
    if (!nextTitle) return

    const updated = await conversation.updateSession(sessionId, {
      title: nextTitle,
      updatedAt: Date.now()
    })
    if (updated) upsertSummary(updated)
  }

  async function renameSession(id: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    const nextTitle = makeTitle(trimmed)
    const idx = summaries.value.findIndex((s) => s.id === id)
    const previous = idx >= 0 ? summaries.value[idx] : null
    if (previous) summaries.value[idx] = { ...previous, title: nextTitle, updatedAt: Date.now() }

    try {
      const updated = await conversation.updateSession(id, { title: nextTitle })
      if (updated) upsertSummary(updated)
      else await refreshList()
    } catch (e) {
      if (previous && idx >= 0) summaries.value[idx] = previous
      throw e
    }
  }

  async function archiveSession(id: string): Promise<void> {
    const archivedAt = Date.now()
    const previousSummaries = summaries.value
    const idx = summaries.value.findIndex((s) => s.id === id)
    const previous = idx >= 0 ? summaries.value[idx] : null
    if (showArchived.value && previous) {
      summaries.value[idx] = { ...previous, archivedAt }
    } else {
      summaries.value = summaries.value.filter((s) => s.id !== id)
    }

    const wasActive = activeSessionId.value === id
    if (wasActive) {
      activeSessionId.value = summaries.value[0]?.id ?? null
      await persistActiveSession()
    }

    try {
      const updated = await conversation.updateSession(id, { archivedAt })
      if (!updated) {
        await refreshList()
        return
      }
      if (showArchived.value) upsertSummary(updated)
    } catch (e) {
      summaries.value = previousSummaries
      if (wasActive) {
        activeSessionId.value = id
        await persistActiveSession()
      }
      throw e
    }
  }

  async function unarchiveSession(id: string): Promise<void> {
    const previousSummaries = summaries.value
    const idx = summaries.value.findIndex((s) => s.id === id)
    const previous = idx >= 0 ? summaries.value[idx] : null
    if (previous) summaries.value[idx] = { ...previous, archivedAt: undefined }

    try {
      const updated = await conversation.updateSession(id, { archivedAt: null })
      if (updated) upsertSummary(updated)
      else await refreshList()
    } catch (e) {
      summaries.value = previousSummaries
      throw e
    }
  }

  async function deleteSession(id: string): Promise<void> {
    await conversation.deleteSession(id)
    summaries.value = summaries.value.filter((s) => s.id !== id)
    messageCache.value.delete(id)
    if (activeSessionId.value === id) {
      activeSessionId.value = summaries.value[0]?.id ?? null
      await persistActiveSession()
    }
  }

  async function selectByShortcut(index: number): Promise<ChatSession | null> {
    const item = projectGroups.value[0]?.items[index]
    if (!item) return null
    return selectSession(item.id)
  }

  function resetOnLogout(): void {
    loaded.value = false
    summaries.value = []
    activeSessionId.value = null
    messageCache.value = new Map()
    showArchived.value = false
  }

  return {
    summaries,
    activeSessionId,
    activeSession,
    projectGroups,
    primaryGroupSize,
    showArchived,
    load,
    refreshList,
    toggleShowArchived,
    searchSessions,
    createSession,
    createSessionWithTitle,
    selectSession,
    selectSessionWithProject,
    newChat,
    ensureActiveSession,
    loadSessionMessages,
    updateSessionMessages,
    appendMessageToSession,
    upsertMessageToSession,
    touchSession,
    canApplyAutoTitle,
    applyAutoTitle,
    renameSession,
    archiveSession,
    unarchiveSession,
    deleteSession,
    selectByShortcut,
    resetOnLogout
  }
})
