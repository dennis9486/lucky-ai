import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { MessagePart } from '../../shared/types/ai.js'
import type {
  CodeAgentEffort,
  CodeAgentMode,
  CodeAgentPlanOption,
  CodeAgentPlanSet,
  CodeAgentQueuedTurn,
  CodeAgentSession,
  CodeAgentTurn,
  PersistedCodeAgentState
} from '../../shared/types/code-agent.js'
import type { AgentScopeToolCallInfo } from '../../shared/types/agentscope.js'
import type { AgentTurnRevertResult } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import { runAgentScope, confirmAgentTools, summarizeAgentTitle, type AgentRunnerEvent } from '../services/agentscope-client.js'
import { conversation } from '../services/conversation-client.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { i18n } from '../i18n/index.js'
import { appendText, appendThinking, findToolPart, partsToPlainText, snapshotParts } from '../utils/message-parts.js'
import { buildAgentRunSummary } from '../utils/agent-run-summary.js'
import { clearAgentToolEdit, previewAgentToolEdit } from '../services/ai-inline-edit.service.js'
import { useEditorStore } from './editor.store.js'
import { useProjectStore } from './project.store.js'
import type { ComposerAttachment, ComposerAttachmentInput } from './ui.store.js'
import { useWorkspaceStore } from './workspace.store.js'
import { isImagePath, mentionPlainText } from '../utils/mention.js'
import { compactGeneratedTitle, normalizeGeneratedTitleText } from '../utils/title.js'

const logger = createLogger('renderer/code-agent-store', {
  debugEnabled: () => Boolean(import.meta.env.DEV)
})

export type {
  CodeAgentEffort,
  CodeAgentMode,
  CodeAgentSession,
  CodeAgentTurn
} from '../../shared/types/code-agent.js'

const MODE_PROMPTS: Record<CodeAgentMode, string> = {
  agent: 'Act as an autonomous coding agent. Inspect the workspace, edit files with tools, and verify when useful.',
  plan: 'Plan first. Do not modify files unless the user explicitly asks you to execute the plan.',
  debug: 'Debug carefully. Use logs, errors, and relevant source files to identify root causes before editing.',
  multitask: 'Break the work into clear sub-tasks, keep progress explicit, and execute them in a practical order.',
  ask: 'Answer questions about the codebase. Do not edit files unless the user explicitly requests changes.'
}

const EFFORT_PROMPTS: Record<CodeAgentEffort, string> = {
  auto: 'Use the appropriate amount of context and verification for the task.',
  fast: 'Prefer small, quick, low-risk edits and concise verification.',
  high: 'Use deeper analysis, broader context, and stronger verification before concluding.'
}

const PLAN_OPTION_FALLBACKS = [
  { label: 'A', titleKey: 'codeAgent.planOptionMinimal', risk: 'low' },
  { label: 'B', titleKey: 'codeAgent.planOptionStandard', risk: 'medium' },
  { label: 'C', titleKey: 'codeAgent.planOptionArchitecture', risk: 'high' }
] as const

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(state: PersistedCodeAgentState): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistState(state)
  }, 120)
}

async function persistState(state: PersistedCodeAgentState): Promise<void> {
  try {
    const sessions = state.sessions
      .slice(-MAX_PERSISTED_SESSIONS)
      .map((session) => ({
        ...session,
        turns: session.turns.map((turn) => ({
          ...turn,
          parts: turn.parts.map((part) => ({ ...part }))
        }))
      }))
    await conversation.setCodeAgentState({
      activeSessionId: state.activeSessionId,
      activeSessionIdsByWorkspace: state.activeSessionIdsByWorkspace ?? {},
      mode: state.mode,
      effort: state.effort,
      sessions
    })
  } catch (error) {
    logger.debug('persist code-agent state failed', { error })
  }
}

const MAX_PERSISTED_SESSIONS = 30
const NO_WORKSPACE_KEY = '__no_workspace__'

export const useCodeAgentStore = defineStore('codeAgent', () => {
  const editor = useEditorStore()
  const project = useProjectStore()
  const workspace = useWorkspaceStore()

  const input = ref('')
  const mode = ref<CodeAgentMode>('agent')
  const effort = ref<CodeAgentEffort>('auto')
  const isRunning = ref(false)
  const hydrated = ref(false)
  const sessions = ref<CodeAgentSession[]>([createSession()])
  const activeSessionId = ref(sessions.value[0]!.id)
  const activeSessionIdsByWorkspace = ref<Record<string, string>>({})
  const runningSessionId = ref<string | null>(null)
  const lastError = ref('')
  const usage = ref<{ input: number; output: number } | null>(null)
  const abortController = ref<AbortController | null>(null)
  const editingTurnId = ref<string | null>(null)
  const attachments = ref<ComposerAttachment[]>([])

  const inFlightRun = ref<{ sessionId: string; turnId: string; parts: MessagePart[] } | null>(null)

  const pendingConfirm = ref<{
    agentSessionId: string
    codeSessionId: string
    replyId: string
    toolCalls: AgentScopeToolCallInfo[]
  } | null>(null)

  const showPendingConfirm = computed(() =>
    pendingConfirm.value !== null
    && pendingConfirm.value.codeSessionId === activeSessionId.value
  )

  const workspaceKey = computed(() =>
    project.activeProject?.rootPath ?? workspace.workspace?.rootPath ?? NO_WORKSPACE_KEY
  )

  const workspaceMeta = computed(() => ({
    workspaceName: project.activeProject?.name ?? workspace.workspace?.name,
    workspacePath: project.activeProject?.rootPath ?? workspace.workspace?.rootPath
  }))

  const workspaceSessions = computed(() =>
    sessions.value.filter((session) => sessionMatchesWorkspace(session, workspaceKey.value))
  )

  const activeSession = computed(() =>
    workspaceSessions.value.find((session) => session.id === activeSessionId.value)
    ?? workspaceSessions.value.find((session) => !session.archived)
  )

  const visibleSessions = computed(() =>
    workspaceSessions.value.filter((session) => !session.archived)
  )

  const archivedSessions = computed(() =>
    workspaceSessions.value
      .filter((session) => session.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  )

  const turns = computed(() => activeSession.value?.turns ?? [])
  const parts = computed(() => turns.value.flatMap((turn) => turn.parts))
  const lastUserText = computed(() => activeSession.value?.lastUserText ?? '')
  const queuedTurns = computed(() => activeSession.value?.queuedTurns ?? [])
  const activePlan = computed(() => {
    const plan = activeSession.value?.pendingPlan
    return plan?.status === 'draft' ? plan : null
  })

  const hasOutput = computed(() => turns.value.some((turn) =>
    turn.parts.some((part) =>
      part.type === 'tool'
        || (part.type === 'text' && part.text.trim())
        || (part.type === 'thinking' && part.text.trim())
    )
  ))

  watch(
    [sessions, activeSessionId, activeSessionIdsByWorkspace, mode, effort],
    () => {
      if (!hydrated.value) return
      schedulePersist(buildPersistedState())
    },
    { deep: true }
  )

  watch(activeSessionId, (activeId) => {
    const session = sessions.value.find((item) => item.id === activeId)
    if (session && sessionMatchesWorkspace(session, workspaceKey.value)) {
      activeSessionIdsByWorkspace.value = {
        ...activeSessionIdsByWorkspace.value,
        [workspaceKey.value]: activeId
      }
    }
    if (!inFlightRun.value || !runningSessionId.value) return
    if (activeId !== runningSessionId.value) return
    const turn = sessions.value
      .find((session) => session.id === inFlightRun.value?.sessionId)
      ?.turns.find((item) => item.id === inFlightRun.value?.turnId)
    if (turn) turn.parts = snapshotParts(inFlightRun.value.parts)
  })

  watch(workspaceKey, (key, previousKey) => {
    switchToWorkspaceSession(key, 'workspace-change', previousKey)
  })

  function ensureWorkspaceSession(): CodeAgentSession {
    const existing = workspaceSessions.value.find((session) => !session.archived) ?? workspaceSessions.value[0]
    if (existing) return existing
    const session = createSession(workspaceMeta.value)
    sessions.value.push(session)
    logger.info('create code-agent workspace session', {
      sessionId: session.id,
      workspacePath: session.workspacePath ?? null
    })
    return session
  }

  /** Keep Code Agent tabs scoped to the selected project and restore the last active tab per workspace. */
  function switchToWorkspaceSession(
    key = workspaceKey.value,
    reason: 'load' | 'workspace-change' = 'workspace-change',
    previousKey?: string
  ): void {
    const saved = activeSessionIdsByWorkspace.value[key]
    const nextId = resolveActiveSessionId(workspaceSessions.value, saved) ?? ensureWorkspaceSession().id
    activeSessionId.value = nextId
    editingTurnId.value = null
    input.value = ''
    pendingConfirm.value = null
    logger.info('switch code-agent workspace session', {
      reason,
      previousWorkspace: previousKey ?? null,
      workspace: key,
      sessionId: nextId
    })
  }

  async function load(): Promise<void> {
    if (hydrated.value) return
    const persisted = await conversation.getCodeAgentState().catch(() => null)
    if (persisted) {
      sessions.value = recoverInterruptedTurns(persisted.sessions)
      activeSessionIdsByWorkspace.value = persisted.activeSessionIdsByWorkspace ?? {}
      switchToWorkspaceSession(workspaceKey.value, 'load')
      mode.value = persisted.mode
      effort.value = persisted.effort
    }
    hydrated.value = true
  }

  function buildPersistedState(): PersistedCodeAgentState {
    return {
      activeSessionId: activeSessionId.value,
      activeSessionIdsByWorkspace: activeSessionIdsByWorkspace.value,
      mode: mode.value,
      effort: effort.value,
      sessions: sessions.value
    }
  }

  async function send(): Promise<void> {
    const text = input.value.trim()
    if (!text && attachments.value.length === 0) return
    const hasWorkspace = await project.ensureWorkspace()
    if (!hasWorkspace) return
    const session = activeSession.value ?? newSession()
    const requestAttachments = attachments.value.map((item) => ({ ...item }))
    if (isRunning.value) {
      enqueue(text || String(i18n.global.t('chat.defaultAttachmentPrompt')), requestAttachments, session.id)
      input.value = ''
      clearAttachments()
      await persistState(buildPersistedState())
      return
    }
    if (shouldPlanFirst(text, requestAttachments, session)) {
      await runRequest(text, session, requestAttachments, { kind: 'planning' })
      return
    }
    await runRequest(text, session, requestAttachments)
  }

  async function runRequest(
    text: string,
    session: CodeAgentSession,
    requestAttachments: ComposerAttachment[],
    options: {
      kind?: 'normal' | 'planning' | 'execute-plan'
      promptText?: string
      displayText?: string
      selectedPlan?: CodeAgentPlanSet
      selectedOption?: CodeAgentPlanOption
    } = {}
  ): Promise<void> {
    const userText = (options.displayText ?? text) || String(i18n.global.t('chat.defaultAttachmentPrompt'))
    const promptText = options.promptText ?? userText

    if (editingTurnId.value) {
      const editIndex = session.turns.findIndex((turn) => turn.id === editingTurnId.value)
      if (editIndex >= 0) {
        const paths = truncateTurnsFromIndex(editIndex)
        if (paths.length) await editor.reloadFiles(paths)
        await Promise.allSettled([workspace.refreshTree(), project.refreshGitBranch()])
      }
      editingTurnId.value = null
    }

    input.value = ''
    session.lastUserText = userText
    if (session.titleSource !== 'manual') {
      session.title = titleFromText(userText)
      session.titleSource = 'auto'
    }
    session.updatedAt = Date.now()
    lastError.value = ''
    usage.value = null
    isRunning.value = true
    runningSessionId.value = session.id
    abortController.value = new AbortController()

    const turn: CodeAgentTurn = {
      id: crypto.randomUUID(),
      userText,
      parts: [],
      createdAt: Date.now(),
      streaming: true,
      planRole: options.kind === 'planning' ? 'proposal' : options.kind === 'execute-plan' ? 'execution' : undefined
    }
    session.turns.push(turn)

    const workingParts = turn.parts
    inFlightRun.value = { sessionId: session.id, turnId: turn.id, parts: workingParts }
    let errored = false
    let stopped = false

    const sync = () => {
      const target = sessions.value.find((item) => item.id === inFlightRun.value?.sessionId)
      if (!target) return
      const activeTurn = target.turns.find((item) => item.id === inFlightRun.value?.turnId)
      if (!activeTurn) return
      activeTurn.parts = snapshotParts(workingParts)
      activeTurn.streaming = true
      target.updatedAt = Date.now()
    }

    let persistTimer: ReturnType<typeof setTimeout> | null = null
    const schedulePersistStreaming = () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        void persistState(buildPersistedState())
      }, 1500)
    }

    void persistState(buildPersistedState())
    logger.info('start code-agent run', {
      sessionId: session.id,
      conversationId: session.conversationId,
      approvalMode: project.approvalMode,
      attachmentCount: requestAttachments.length
    })

    try {
      await runAgentScope(
        options.kind === 'planning'
          ? buildPlanningPrompt(promptText, session.turns)
          : buildPrompt(promptText, session.turns),
        {
        requestId: turn.id,
        signal: abortController.value.signal,
        approvalMode: options.kind === 'planning' ? 'ask' : project.approvalMode,
        conversationId: session.conversationId,
        agentMode: 'code',
        referenceContextOnly: true,
        referenceMessage: userText,
        attachments: requestAttachments,
        // 关联主进程会话 id（= 文件前像 turn_id），供「回滚本轮文件修改」使用
        onSessionId: (agentSessionId: string) => {
          turn.agentSessionId = agentSessionId
          schedulePersistStreaming()
        },
        onEvent: (event: AgentRunnerEvent) => {
          switch (event.type) {
            case 'text':
              appendText(workingParts, event.content)
              sync()
              schedulePersistStreaming()
              break
            case 'thinking':
              appendThinking(workingParts, event.content)
              sync()
              schedulePersistStreaming()
              break
            case 'tool_call':
              workingParts.push({
                type: 'tool',
                id: event.id,
                name: event.name,
                output: '',
                status: 'running'
              })
              sync()
              schedulePersistStreaming()
              break
            case 'tool_args': {
              const part = findToolPart(workingParts, event.id)
              if (part) {
                part.input = event.input
                void previewAgentToolEdit(part)
              }
              sync()
              schedulePersistStreaming()
              break
            }
            case 'tool_output': {
              const part = findToolPart(workingParts, event.id)
              if (part) part.output += event.delta
              sync()
              schedulePersistStreaming()
              break
            }
            case 'tool_end': {
              const part = findToolPart(workingParts, event.id)
              if (part) {
                part.status = event.status
                part.errorSummary = event.errorSummary
                part.recoverySuggestion = event.recoverySuggestion
                clearAgentToolEdit(event.id)
              }
              sync()
              schedulePersistStreaming()
              break
            }
            case 'tool_recovery': {
              const part = findToolPart(workingParts, event.id)
              if (part) {
                part.retryOf = event.previousId
                part.attempt = event.attempt
              }
              sync()
              schedulePersistStreaming()
              break
            }
            case 'tool_retry_mark': {
              const part = findToolPart(workingParts, event.id)
              if (part) part.retryAttempted = true
              sync()
              schedulePersistStreaming()
              break
            }
            case 'confirm_required':
              pendingConfirm.value = {
                agentSessionId: event.sessionId,
                codeSessionId: session.id,
                replyId: event.replyId,
                toolCalls: event.toolCalls
              }
              sync()
              schedulePersistStreaming()
              break
            case 'tokens':
              usage.value = {
                input: event.input || usage.value?.input || 0,
                output: (usage.value?.output ?? 0) + event.output
              }
              break
            case 'error':
              errored = true
              lastError.value = event.error
              appendText(workingParts, `\n\n> ${event.error}`)
              sync()
              schedulePersistStreaming()
              break
            case 'max_steps':
              errored = true
              lastError.value = event.message
              appendText(workingParts, `\n\n> ${event.message}`)
              sync()
              schedulePersistStreaming()
              break
            case 'done':
              break
          }
        }
      })
    } catch (error) {
      errored = true
      logger.error('code-agent run failed', {
        sessionId: session.id,
        conversationId: session.conversationId,
        error
      })
      const message = error instanceof Error ? error.message : String(error)
      lastError.value = message
      if (!workingParts.length) {
        appendText(workingParts, `> ${message}`)
        sync()
      }
    } finally {
      if (abortController.value?.signal.aborted) stopped = true
      for (const part of workingParts) {
        if (part.type === 'tool' && part.status === 'running') {
          part.status = errored ? 'error' : 'rejected'
        }
      }
      const activeTurn = session.turns.find((item) => item.id === turn.id)
      if (activeTurn) {
        activeTurn.streaming = false
        activeTurn.incomplete = errored || stopped
        activeTurn.runSummary = buildAgentRunSummary(workingParts)
        activeTurn.parts = snapshotParts(workingParts)
        if (options.kind === 'planning' && !errored && !stopped) {
          const plan = createPlanSet(userText, activeTurn.id, partsToPlainText(workingParts))
          activeTurn.planSet = plan
          session.pendingPlan = plan
        }
        if (options.kind === 'execute-plan' && options.selectedPlan) {
          options.selectedPlan.status = errored || stopped ? 'selected' : 'executed'
          options.selectedPlan.updatedAt = Date.now()
          if (!errored && !stopped && session.pendingPlan?.id === options.selectedPlan.id) {
            session.pendingPlan = undefined
          }
        }
      }
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      session.updatedAt = Date.now()
      await persistState(buildPersistedState())
      logger.info('finish code-agent run', {
        sessionId: session.id,
        conversationId: session.conversationId,
        stopped,
        errored,
        partCount: workingParts.length
      })
      isRunning.value = false
      inFlightRun.value = null
      runningSessionId.value = null
      pendingConfirm.value = null
      abortController.value = null
      clearAttachments()
      await refreshTitleAfterRun(session, userText, workingParts)
      await refreshAfterRun(workingParts)

      const content = partsToPlainText(workingParts)
      if (content && !errored && !stopped) {
        void unwrap(
          ipc.memory.capture({
            sessionId: session.id,
            workspacePath: project.activeProject?.rootPath,
            userMessage: userText,
            assistantMessage: content,
            usedTools: workingParts.some((part) => part.type === 'tool')
          })
        )
      }
      if (!stopped && !errored && options.kind !== 'planning') await runNextQueued(session.id)
    }
  }

  async function executePlan(optionId: string): Promise<void> {
    const session = activeSession.value
    const plan = session?.pendingPlan
    const option = plan?.options.find((item) => item.id === optionId)
    if (!session || !plan || !option || isRunning.value) return
    plan.status = 'selected'
    plan.selectedOptionId = option.id
    plan.updatedAt = Date.now()
    await persistState(buildPersistedState())
    await runRequest(plan.request, session, [], {
      kind: 'execute-plan',
      displayText: plan.request,
      promptText: buildExecutePlanPrompt(plan, option),
      selectedPlan: plan,
      selectedOption: option
    })
  }

  function dismissActivePlan(): void {
    const plan = activeSession.value?.pendingPlan
    if (!activeSession.value || !plan) return
    plan.status = 'dismissed'
    plan.updatedAt = Date.now()
    activeSession.value.pendingPlan = undefined
    activeSession.value.updatedAt = Date.now()
    void persistState(buildPersistedState())
  }

  function enqueue(
    text: string,
    queuedAttachments: ComposerAttachment[] = [],
    sessionId = activeSessionId.value
  ): CodeAgentQueuedTurn | null {
    const session = sessions.value.find((item) => item.id === sessionId)
    const clean = text.trim()
    if (!session || !clean) return null
    const now = Date.now()
    const queued: CodeAgentQueuedTurn = {
      id: crypto.randomUUID(),
      text: clean,
      attachments: queuedAttachments.map(({ path, name, kind, mimeType }) => ({ path, name, kind, mimeType })),
      createdAt: now,
      updatedAt: now
    }
    session.queuedTurns ??= []
    session.queuedTurns.push(queued)
    session.updatedAt = now
    void persistState(buildPersistedState())
    return queued
  }

  async function runNextQueued(sessionId: string): Promise<void> {
    if (isRunning.value) return
    const session = sessions.value.find((item) => item.id === sessionId)
    const next = session?.queuedTurns?.shift()
    if (!session || !next) return
    session.updatedAt = Date.now()
    await persistState(buildPersistedState())
    await runRequest(next.text, session, next.attachments ?? [])
  }

  function updateQueuedTurn(id: string, text: string): void {
    const session = activeSession.value
    const clean = text.trim()
    const item = session?.queuedTurns?.find((queued) => queued.id === id)
    if (!session || !item || !clean) return
    item.text = clean
    item.updatedAt = Date.now()
    session.updatedAt = item.updatedAt
    void persistState(buildPersistedState())
  }

  function removeQueuedTurn(id: string): void {
    const session = activeSession.value
    if (!session?.queuedTurns?.length) return
    session.queuedTurns = session.queuedTurns.filter((queued) => queued.id !== id)
    session.updatedAt = Date.now()
    void persistState(buildPersistedState())
  }

  function moveQueuedTurnUp(id: string): void {
    const queue = activeSession.value?.queuedTurns
    if (!queue) return
    const index = queue.findIndex((queued) => queued.id === id)
    if (index <= 0) return
    const [item] = queue.splice(index, 1)
    if (item) queue.splice(index - 1, 0, item)
    if (activeSession.value) activeSession.value.updatedAt = Date.now()
    void persistState(buildPersistedState())
  }

  async function continueTurn(turnId: string): Promise<void> {
    const session = activeSession.value
    if (!session || isRunning.value) return
    const index = session.turns.findIndex((turn) => turn.id === turnId)
    if (index < 0) return
    const turn = session.turns[index]!
    editingTurnId.value = null
    input.value = turn.userText
    session.turns.splice(index, 1)
    await send()
  }

  function beginEditTurn(turnId: string): void {
    if (isRunning.value) return
    const turn = activeSession.value?.turns.find((item) => item.id === turnId)
    if (!turn) return
    editingTurnId.value = turnId
    input.value = turn.userText
  }

  function cancelEditTurn(): void {
    editingTurnId.value = null
    input.value = ''
  }

  async function rollbackToTurn(turnId: string): Promise<void> {
    if (isRunning.value) stop()
    const session = activeSession.value
    if (!session) return
    const index = session.turns.findIndex((turn) => turn.id === turnId)
    if (index < 0) return

    const paths = truncateTurnsFromIndex(index)
    if (editingTurnId.value && !session.turns.some((turn) => turn.id === editingTurnId.value)) {
      editingTurnId.value = null
      input.value = ''
    }

    if (paths.length) await editor.reloadFiles(paths)
    await Promise.allSettled([workspace.refreshTree(), project.refreshGitBranch()])
    void persistState(buildPersistedState())
  }

  function truncateTurnsFromIndex(index: number): string[] {
    const session = activeSession.value
    if (!session || index < 0 || index >= session.turns.length) return []
    const removed = session.turns.slice(index)
    session.turns.splice(index)
    session.lastUserText = session.turns.at(-1)?.userText ?? ''
    session.updatedAt = Date.now()
    // 轮换 conversationId 让主进程重建 Agent；旧会话的缓存实例（含 MCP 连接）
    // 与持久化上下文立即清理，避免泄漏与陈旧记忆残留
    const previousConversationId = session.conversationId
    session.conversationId = `code-agent-${crypto.randomUUID()}`
    void ipc.agent.resetConversation(previousConversationId).catch(() => {})
    return collectRemovedTurnPaths(removed)
  }

  /** 回滚某轮 Agent 的全部文件修改（恢复前像 / 删除该轮新建文件），会话记录保留 */
  async function revertTurnFiles(turnId: string): Promise<void> {
    const session = activeSession.value
    if (!session || isRunning.value) return
    const turn = session.turns.find((item) => item.id === turnId)
    if (!turn?.agentSessionId) return

    try {
      const result = await unwrap<AgentTurnRevertResult>(ipc.agent.revertTurn(turn.agentSessionId))
      const paths = [...result.restored, ...result.deleted]
      logger.info('revert turn files', {
        turnId,
        agentSessionId: turn.agentSessionId,
        restored: result.restored.length,
        deleted: result.deleted.length,
        skipped: result.skipped.length
      })
      if (paths.length) await editor.reloadFiles(paths)
      await Promise.allSettled([workspace.refreshTree(), project.refreshGitBranch()])
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  function confirmTools(approved: boolean): void {
    if (!pendingConfirm.value) return
    const { agentSessionId, replyId, toolCalls } = pendingConfirm.value
    const parts = inFlightRun.value?.parts
    confirmAgentTools(
      agentSessionId,
      replyId,
      toolCalls.map((toolCall) => ({ toolCallId: toolCall.id, confirmed: approved }))
    )
    if (!approved && parts) {
      for (const toolCall of toolCalls) {
        const part = findToolPart(parts, toolCall.id)
        if (part && part.status === 'running') part.status = 'rejected'
      }
      syncSessionParts(inFlightRun.value?.sessionId, parts)
    }
    pendingConfirm.value = null
  }

  function syncSessionParts(sessionId: string | undefined, parts: MessagePart[]): void {
    if (!sessionId) return
    const session = sessions.value.find((item) => item.id === sessionId)
    if (!session) return
    const turnId = inFlightRun.value?.turnId
    const turn = turnId
      ? session.turns.find((item) => item.id === turnId)
      : session.turns[session.turns.length - 1]
    if (!turn) return
    turn.parts = snapshotParts(parts)
    session.updatedAt = Date.now()
  }

  function stop(): void {
    if (!isRunning.value) return
    logger.info('stop code-agent run requested', {
      sessionId: runningSessionId.value,
      conversationId: activeSession.value?.conversationId
    })
    abortController.value?.abort()
  }

  function clear(): void {
    const session = activeSession.value
    if (!session) return
    session.turns = []
    session.queuedTurns = []
    session.pendingPlan = undefined
    session.reviewedChangeSignatures = []
    session.lastUserText = ''
    session.title = defaultAgentTitle()
    session.titleSource = 'auto'
    session.conversationId = `code-agent-${crypto.randomUUID()}`
    session.updatedAt = Date.now()
    lastError.value = ''
    usage.value = null
    pendingConfirm.value = null
    clearAttachments()
  }

  function addAttachments(items: ComposerAttachmentInput[]): void {
    const next = items.map(normalizeCodeAttachment)
    const merged = new Map(attachments.value.map((item) => [item.path, item]))
    for (const item of next) merged.set(item.path, item)
    attachments.value = [...merged.values()]
  }

  function removeAttachment(path: string): void {
    const removed = attachments.value.find((item) => item.path === path)
    revokePreviewUrl(removed?.previewUrl)
    attachments.value = attachments.value.filter((item) => item.path !== path)
  }

  /** 用编辑器内联引用整体替换 file/folder 附件，图片附件保持不变（供富文本输入框同步） */
  function setFileReferences(refs: ComposerAttachmentInput[]): void {
    const images = attachments.value.filter((item) => item.kind === 'image')
    const nextRefs = refs.map(normalizeCodeAttachment)
    const merged = new Map(nextRefs.map((item) => [item.path, item]))
    attachments.value = [...images, ...merged.values()]
  }

  function clearAttachments(): void {
    for (const item of attachments.value) revokePreviewUrl(item.previewUrl)
    attachments.value = []
  }

  function newSession(): CodeAgentSession {
    const session = createSession(workspaceMeta.value)
    sessions.value.push(session)
    activeSessionId.value = session.id
    input.value = ''
    pendingConfirm.value = null
    return session
  }

  function switchSession(id: string): void {
    if (sessions.value.some((session) => session.id === id)) {
      activeSessionId.value = id
      editingTurnId.value = null
      input.value = ''
    }
  }

  function closeSession(id = activeSessionId.value): void {
    if (sessions.value.length <= 1) {
      const session = createSession(workspaceMeta.value)
      sessions.value = [session]
      activeSessionId.value = session.id
      input.value = ''
      lastError.value = ''
      usage.value = null
      pendingConfirm.value = null
      return
    }
    const index = sessions.value.findIndex((session) => session.id === id)
    if (index < 0) return
    sessions.value.splice(index, 1)
    if (activeSessionId.value === id) {
      activeSessionId.value = visibleSessions.value[Math.min(index, visibleSessions.value.length - 1)]?.id
        ?? ensureWorkspaceSession().id
    }
  }

  function closeOtherSessions(id = activeSessionId.value): void {
    sessions.value = sessions.value.filter((session) =>
      !sessionMatchesWorkspace(session, workspaceKey.value) || session.id === id || session.archived
    )
    activeSessionId.value = id
  }

  function closeSessionsToRight(id = activeSessionId.value): void {
    const index = visibleSessions.value.findIndex((session) => session.id === id)
    if (index < 0) return
    const keepIds = new Set(visibleSessions.value.slice(0, index + 1).map((session) => session.id))
    sessions.value = sessions.value.filter((session) =>
      !sessionMatchesWorkspace(session, workspaceKey.value) || session.archived || keepIds.has(session.id)
    )
    activeSessionId.value = id
  }

  function archiveSession(id = activeSessionId.value): void {
    const session = sessions.value.find((item) => item.id === id)
    if (!session) return
    session.archived = true
    session.updatedAt = Date.now()
    if (activeSessionId.value === id) {
      activeSessionId.value = visibleSessions.value.find((item) => item.id !== id)?.id ?? newSession().id
    }
  }

  function restoreSession(id: string): void {
    const session = sessions.value.find((item) => item.id === id)
    if (!session) return
    session.archived = false
    session.updatedAt = Date.now()
    activeSessionId.value = id
  }

  function renameSession(id: string, title: string): void {
    const session = sessions.value.find((item) => item.id === id)
    const next = title.trim()
    if (!session || !next) return
    session.title = next
    session.titleSource = 'manual'
    session.updatedAt = Date.now()
  }

  function togglePin(id: string): void {
    const session = sessions.value.find((item) => item.id === id)
    if (!session) return
    session.pinned = !session.pinned
    session.updatedAt = Date.now()
  }

  function markReviewedChanges(signatures: string[]): void {
    const session = activeSession.value
    if (!session || !signatures.length) return
    const next = new Set(session.reviewedChangeSignatures ?? [])
    for (const signature of signatures) {
      if (signature.trim()) next.add(signature)
    }
    session.reviewedChangeSignatures = [...next]
    session.updatedAt = Date.now()
  }

  function shouldPlanFirst(
    text: string,
    requestAttachments: ComposerAttachment[],
    session: CodeAgentSession
  ): boolean {
    if (editingTurnId.value) return false
    if (mode.value === 'ask') return false
    const clean = text.trim()
    if (!clean && !requestAttachments.length) return false
    if (session.pendingPlan?.status === 'draft' && session.pendingPlan.request.trim() === clean) return false
    return looksLikeDevelopmentRequest(clean) || requestAttachments.some((item) => item.kind === 'file' || item.kind === 'folder')
  }

  function buildPrompt(userText: string, sessionTurns: CodeAgentTurn[]): string {
    const active = editor.activeTab
    const activeExcerpt = active ? excerpt(active.content, 14000) : ''
    const openTabs = editor.tabs.map((tab) => tab.path)
    const rootPath = project.activeProject?.rootPath ?? workspace.workspace?.rootPath ?? ''
    const history = buildConversationContext(sessionTurns)

    return [
      'You are Lucky, the code agent embedded in an Electron + Monaco code editor.',
      MODE_PROMPTS[mode.value],
      EFFORT_PROMPTS[effort.value],
      'When code changes are needed, use available file tools so changes are written to disk. Do not merely describe edits.',
      'Respect existing style, keep edits scoped, and summarize changed files plus verification.',
      '',
      `<workspace>${rootPath || 'No workspace selected'}</workspace>`,
      active ? `<active_file path="${active.path}" language="${active.language}">\n${activeExcerpt}\n</active_file>` : '<active_file>None</active_file>',
      openTabs.length ? `<open_tabs>\n${openTabs.map((path) => `- ${path}`).join('\n')}\n</open_tabs>` : '<open_tabs>None</open_tabs>',
      history,
      '',
      `<user_request>\n${userText}\n</user_request>`
    ].filter(Boolean).join('\n')
  }

  function buildPlanningPrompt(userText: string, sessionTurns: CodeAgentTurn[]): string {
    const active = editor.activeTab
    const openTabs = editor.tabs.map((tab) => tab.path)
    const rootPath = project.activeProject?.rootPath ?? workspace.workspace?.rootPath ?? ''
    const history = buildConversationContext(sessionTurns)

    return [
      'You are Lucky, the code agent in proposal mode.',
      'The user may be asking for a code change. Do not modify files. Do not run tools. Do not execute commands.',
      'Your job is to create 2 or 3 practical implementation options and wait for the user to choose one.',
      'Keep the plan concise, executable, and honest about tradeoffs.',
      'Use these defaults when useful, but adapt labels to the task:',
      '- Option A: minimal-change path',
      '- Option B: standard engineering path',
      '- Option C: long-term architecture path',
      'For each option, include Summary, Tradeoffs, Verification, and Risk: low|medium|high.',
      'End by asking the user to choose an option to continue. Do not ask unrelated questions.',
      '',
      `<workspace>${rootPath || 'No workspace selected'}</workspace>`,
      active ? `<active_file path="${active.path}" language="${active.language}" />` : '<active_file>None</active_file>',
      openTabs.length ? `<open_tabs>\n${openTabs.map((path) => `- ${path}`).join('\n')}\n</open_tabs>` : '<open_tabs>None</open_tabs>',
      history,
      '',
      `<user_request>\n${userText}\n</user_request>`
    ].filter(Boolean).join('\n')
  }

  function buildExecutePlanPrompt(plan: CodeAgentPlanSet, option: CodeAgentPlanOption): string {
    return [
      'Execute the selected implementation plan.',
      'You may inspect and edit files with tools. Keep changes scoped to the selected plan and verify the result.',
      '',
      '<original_user_request>',
      plan.request,
      '</original_user_request>',
      '',
      '<selected_plan>',
      `Label: ${option.label}`,
      `Title: ${option.title}`,
      `Summary: ${option.summary}`,
      option.tradeoffs.length ? `Tradeoffs:\n${option.tradeoffs.map((item) => `- ${item}`).join('\n')}` : '',
      option.verification.length ? `Verification:\n${option.verification.map((item) => `- ${item}`).join('\n')}` : '',
      `Risk: ${option.estimatedRisk}`,
      '</selected_plan>'
    ].filter(Boolean).join('\n')
  }

  async function refreshAfterRun(nextParts: MessagePart[]): Promise<void> {
    const touched = collectTouchedPaths(nextParts)
    if (touched.length) await editor.reloadFiles(touched)
    await Promise.allSettled([
      workspace.refreshTree(),
      project.refreshGitBranch()
    ])
  }

  async function refreshTitleAfterRun(
    session: CodeAgentSession,
    userText: string,
    nextParts: MessagePart[]
  ): Promise<void> {
    if (session.titleSource === 'manual') return
    const assistantText = collectAssistantText(nextParts)
    try {
      const title = await summarizeAgentTitle({
        userMessage: userText,
        assistantText,
        workspaceName: project.activeProject?.name ?? workspace.workspace?.name,
        locale: String(i18n.global.locale.value)
      })
      const cleanTitle = normalizeTitle(title)
      const currentSession = sessions.value.find((item) => item.id === session.id)
      if (!cleanTitle || !currentSession || currentSession.titleSource === 'manual') return
      currentSession.title = cleanTitle
      currentSession.titleSource = 'auto'
      currentSession.updatedAt = Date.now()
    } catch {
      // Keep the local fallback title when the configured model is unavailable.
    }
  }

  return {
    input,
    mode,
    effort,
    isRunning,
    sessions,
    activeSessionId,
    activeSession,
    visibleSessions,
    archivedSessions,
    turns,
    parts,
    lastUserText,
    queuedTurns,
    activePlan,
    lastError,
    usage,
    pendingConfirm,
    showPendingConfirm,
    attachments,
    hasOutput,
    hydrated,
    runningSessionId,
    editingTurnId,
    load,
    send,
    executePlan,
    dismissActivePlan,
    enqueue,
    updateQueuedTurn,
    removeQueuedTurn,
    moveQueuedTurnUp,
    continueTurn,
    beginEditTurn,
    cancelEditTurn,
    rollbackToTurn,
    revertTurnFiles,
    confirmTools,
    stop,
    clear,
    addAttachments,
    removeAttachment,
    setFileReferences,
    clearAttachments,
    newSession,
    switchSession,
    closeSession,
    closeOtherSessions,
    closeSessionsToRight,
    archiveSession,
    restoreSession,
    renameSession,
    togglePin,
    markReviewedChanges
  }
})

function createSession(meta: { workspaceName?: string; workspacePath?: string } = {}): CodeAgentSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    workspaceName: meta.workspaceName,
    workspacePath: meta.workspacePath,
    title: defaultAgentTitle(),
    titleSource: 'auto',
    conversationId: `code-agent-${crypto.randomUUID()}`,
    turns: [],
    queuedTurns: [],
    reviewedChangeSignatures: [],
    lastUserText: '',
    createdAt: now,
    updatedAt: now,
    archived: false,
    pinned: false
  }
}

function createPlanSet(request: string, sourceTurnId: string, assistantText: string): CodeAgentPlanSet {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    status: 'draft',
    request,
    sourceTurnId,
    options: parsePlanOptions(assistantText),
    createdAt: now,
    updatedAt: now
  }
}

function parsePlanOptions(text: string): CodeAgentPlanOption[] {
  const json = parsePlanOptionsJson(text)
  if (json.length) return json

  const normalized = text.replace(/\r\n/g, '\n')
  const headingPattern = /(?:^|\n)(?:#{1,4}\s*)?(?:Option\s*)?([A-C1-3])[).:：、-]?\s*(.+?)(?=\n(?:#{1,4}\s*)?(?:Option\s*)?[A-C1-3][).:：、-]|\n?$)/gis
  const options: CodeAgentPlanOption[] = []
  let match: RegExpExecArray | null
  while ((match = headingPattern.exec(normalized)) && options.length < 3) {
    const label = normalizePlanLabel(match[1] ?? String(options.length + 1), options.length)
    const body = (match[2] ?? '').trim()
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean)
    const title = stripMarkdown(lines[0] ?? fallbackPlanTitle(options.length))
    const summary = stripMarkdown(lines.slice(1, 5).find((line) => !/^[-*]\s/.test(line)) ?? title)
    options.push({
      id: crypto.randomUUID(),
      label,
      title,
      summary,
      tradeoffs: collectLabeledList(lines, /tradeoffs?|权衡|取舍|代价/i).slice(0, 3),
      verification: collectLabeledList(lines, /verification|verify|验证|测试/i).slice(0, 3),
      estimatedRisk: inferRisk(body)
    })
  }
  if (options.length >= 2) return options

  return PLAN_OPTION_FALLBACKS.map((item, index) => ({
    id: crypto.randomUUID(),
    label: item.label,
    title: fallbackPlanTitle(index),
    summary: String(i18n.global.t('codeAgent.planOptionFallbackSummary')),
    tradeoffs: [String(i18n.global.t('codeAgent.planOptionFallbackTradeoff'))],
    verification: [String(i18n.global.t('codeAgent.planOptionFallbackVerification'))],
    estimatedRisk: item.risk
  }))
}

function parsePlanOptionsJson(text: string): CodeAgentPlanOption[] {
  const block = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
  if (!block) return []
  try {
    const parsed = JSON.parse(block) as { options?: Array<Partial<CodeAgentPlanOption>> }
    return (parsed.options ?? []).slice(0, 3).map((item, index) => ({
      id: crypto.randomUUID(),
      label: item.label ?? PLAN_OPTION_FALLBACKS[index]?.label ?? String(index + 1),
      title: item.title?.trim() || fallbackPlanTitle(index),
      summary: item.summary?.trim() || fallbackPlanTitle(index),
      tradeoffs: Array.isArray(item.tradeoffs) ? item.tradeoffs.filter(Boolean).slice(0, 3) : [],
      verification: Array.isArray(item.verification) ? item.verification.filter(Boolean).slice(0, 3) : [],
      estimatedRisk: item.estimatedRisk === 'high' || item.estimatedRisk === 'medium' || item.estimatedRisk === 'low'
        ? item.estimatedRisk
        : PLAN_OPTION_FALLBACKS[index]?.risk ?? 'medium'
    }))
  } catch {
    return []
  }
}

function fallbackPlanTitle(index: number): string {
  return String(i18n.global.t(PLAN_OPTION_FALLBACKS[index]?.titleKey ?? 'codeAgent.planOptionStandard'))
}

function normalizePlanLabel(value: string, index: number): string {
  const clean = value.trim().toUpperCase()
  if (clean === '1') return 'A'
  if (clean === '2') return 'B'
  if (clean === '3') return 'C'
  return /^[A-C]$/.test(clean) ? clean : PLAN_OPTION_FALLBACKS[index]?.label ?? String(index + 1)
}

function collectLabeledList(lines: string[], labelPattern: RegExp): string[] {
  const result: string[] = []
  let collecting = false
  for (const line of lines) {
    if (/^[A-Za-z\u4e00-\u9fff ]+[:：]\s*/.test(line)) collecting = labelPattern.test(line)
    if (!collecting) continue
    const item = stripMarkdown(line.replace(/^[A-Za-z\u4e00-\u9fff ]+[:：]\s*/, '').replace(/^[-*]\s*/, ''))
    if (item) result.push(item)
  }
  return result
}

function inferRisk(text: string): 'low' | 'medium' | 'high' {
  const lower = text.toLowerCase()
  if (/(high|large|migration|architecture|breaking|高|大|迁移|架构|长期)/.test(lower)) return 'high'
  if (/(low|minimal|small|safe|低|小|最小|安全)/.test(lower)) return 'low'
  return 'medium'
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function looksLikeDevelopmentRequest(text: string): boolean {
  if (!text.trim()) return false
  return /(\bimplement\b|\bbuild\b|\badd\b|\bcreate\b|\bfix\b|\bdebug\b|\brefactor\b|\boptimi[sz]e\b|\bmigrate\b|\bintegrate\b|\bsupport\b|\bwire\b|\breplace\b|\bremove\b|\bbug\b|\berror\b|\bfailing\b|\bbroken\b|实现|开发|新增|增加|创建|修复|优化|重构|接入|集成|支持|替换|删除|报错|错误|不能|不生效|完善|调整|升级|改造|补齐)/i.test(text)
}

function recoverInterruptedTurns(sessionList: CodeAgentSession[]): CodeAgentSession[] {
  return sessionList.map((session) => ({
    ...session,
    queuedTurns: session.queuedTurns ?? [],
    reviewedChangeSignatures: session.reviewedChangeSignatures ?? [],
    turns: session.turns.map((turn) => {
      if (!turn.streaming) return turn
      if (turn.runSummary) {
        return {
          ...turn,
          streaming: false,
          incomplete: false
        }
      }
      return {
        ...turn,
        streaming: false,
        incomplete: true
      }
    })
  }))
}

function buildConversationContext(turns: CodeAgentTurn[]): string {
  const prior = turns.slice(0, -1).slice(-6)
  if (!prior.length) return ''
  const blocks = prior.map((turn) => {
    const assistant = collectAssistantText(turn.parts).trim()
    return [
      '<turn>',
      `<user>${turn.userText.trim()}</user>`,
      assistant ? `<assistant>\n${assistant}\n</assistant>` : '<assistant/>',
      '</turn>'
    ].join('\n')
  })
  return ['<conversation_history>', ...blocks, '</conversation_history>'].join('\n')
}

function resolveActiveSessionId(sessions: CodeAgentSession[], activeId?: string): string | null {
  if (activeId && sessions.some((session) => session.id === activeId)) return activeId
  return sessions.find((session) => !session.archived)?.id ?? sessions[0]?.id ?? null
}

function sessionMatchesWorkspace(session: CodeAgentSession, key: string): boolean {
  if (key === NO_WORKSPACE_KEY) return !session.workspacePath
  return session.workspacePath === key
}

function titleFromText(text: string): string {
  return compactGeneratedTitle(mentionPlainText(text), defaultAgentTitle(), 42)
}

function defaultAgentTitle(): string {
  return String(i18n.global.t('codeAgent.newAgent'))
}

function normalizeTitle(text: string): string {
  const compact = text
    .replace(/\r?\n/g, ' ')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^(title|tab\s*title|标题)\s*[:：]\s*/i, '')
  const normalized = normalizeGeneratedTitleText(compact)
  if (!normalized) return ''
  const hasCjk = /[\u3400-\u9fff]/.test(normalized)
  const limit = hasCjk ? 24 : 48
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}...` : normalized
}

function collectAssistantText(parts: MessagePart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text
      if (part.type === 'tool') return `${part.name} ${part.status}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000)
}

function excerpt(content: string, max: number): string {
  if (content.length <= max) return content
  const head = Math.floor(max * 0.62)
  const tail = max - head
  return [
    content.slice(0, head),
    `\n\n... omitted ${content.length - max} characters ...\n\n`,
    content.slice(content.length - tail)
  ].join('')
}

function collectTouchedPaths(parts: MessagePart[]): string[] {
  const paths = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'tool') continue
    const input = part.input ?? {}
    for (const key of ['path', 'file_path', 'target_path', 'absolute_path']) {
      const value = input[key]
      if (typeof value === 'string' && value.startsWith('/')) paths.add(value)
    }
  }
  return [...paths]
}

function collectRemovedTurnPaths(turns: CodeAgentTurn[]): string[] {
  const paths = new Set<string>()
  for (const turn of turns) {
    for (const path of collectTouchedPaths(turn.parts)) paths.add(path)
  }
  return [...paths]
}

function normalizeCodeAttachment(input: ComposerAttachmentInput): ComposerAttachment {
  if (typeof input === 'string') {
    return {
      path: input,
      name: input.split(/[/\\]/).filter(Boolean).pop() ?? input,
      kind: isImagePath(input) ? 'image' : input.includes('.') ? 'file' : 'folder'
    }
  }
  return {
    path: input.path,
    name: input.name ?? input.path.split(/[/\\]/).filter(Boolean).pop() ?? input.path,
    kind: input.kind ?? (isImagePath(input.path) ? 'image' : input.path.includes('.') ? 'file' : 'folder'),
    mimeType: input.mimeType,
    previewUrl: input.previewUrl
  }
}

function revokePreviewUrl(url?: string): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}
