import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ChatMessage, AgentLoopState, MessagePart, TokenUsage, AgentPlan } from '../../shared/types/ai.js'
import type { AgentScopeToolCallInfo } from '../../shared/types/agentscope.js'
import type { AgentRuntimeEventSource, AgentRuntimeEventStatus } from '../../shared/types/agent-runtime.js'
import { createLogger } from '../../shared/utils/log.js'
import { runAgentScope, confirmAgentTools, summarizeAgentTitle, type AgentRunnerEvent } from '../services/agentscope-client.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { appendText, appendThinking, findToolPart, partsToPlainText, snapshotParts, syncViewParts } from '../utils/message-parts.js'
import { parsePlanFromText, advancePlanOnToolDone, markPlanRunning } from '../utils/plan-parser.js'
import { buildAgentRunSummary } from '../utils/agent-run-summary.js'
import { i18n, tGlobal } from '../i18n/index.js'
import { useProjectStore } from './project.store.js'
import { useSessionStore } from './session.store.js'
import { useSettingsStore } from './settings.store.js'
import { useUiStore } from './ui.store.js'
import { useAgentRuntimeStore } from './agent-runtime.store.js'
import type { ComposerAttachment } from './ui.store.js'

const logger = createLogger('renderer/chat-store', {
  debugEnabled: () => Boolean(import.meta.env.DEV)
})

interface InFlightRun {
  chatSessionId: string
  messageId: string
  parts: MessagePart[]
}

interface SendMessageOptions {
  promptPrefix?: string
  referenceContextOnly?: boolean
  referenceMessage?: string
  includeComposerAttachments?: boolean
  runtimeSource?: Extract<AgentRuntimeEventSource, 'chat' | 'browser' | 'task'>
  runtimeTitle?: string
  runtimePriority?: number
  runtimeMetadata?: Record<string, unknown>
  contextMaxChars?: number
}

interface QueuedChatMessage {
  id: string
  userText: string
  agentText: string
  options: SendMessageOptions
  attachments: ComposerAttachment[]
}

interface SessionRunState {
  sessionId: string
  messageId: string
  parts: MessagePart[]
  abortController: AbortController
  loopState: AgentLoopState
  pendingConfirm: {
    agentSessionId: string
    chatSessionId: string
    replyId: string
    toolCalls: AgentScopeToolCallInfo[]
  } | null
  activePlan: AgentPlan | null
  planCollapsed: boolean
}

export const useChatStore = defineStore('chat', () => {
  const sessionStore = useSessionStore()
  const projectStore = useProjectStore()
  const settingsStore = useSettingsStore()
  const uiStore = useUiStore()
  const input = ref('')
  const sessionRuns = ref(new Map<string, SessionRunState>())
  const messageQueues = ref(new Map<string, QueuedChatMessage[]>())
  const loopState = ref<AgentLoopState>({ status: 'idle', currentStep: 0, maxSteps: settingsStore.maxAgentSteps })
  /** 进行中的回合工作副本，用于切会话后恢复流式 UI 与工具确认 */
  const inFlightRun = ref<InFlightRun | null>(null)
  /** 当前回合正在流式生成的结构化片段（思考 + 文本 + 工具卡片） */
  // shallowRef：视图数组每帧整体替换即可触发更新，无需对不断增长的 parts 做深度响应式包裹
  const streamingParts = shallowRef<MessagePart[]>([])
  /** 当前流式回合对应的 assistant 消息 id，用于列表与 live 视图互斥展示 */
  const streamingMessageId = ref<string | null>(null)
  const activePlan = ref<AgentPlan | null>(null)
  const planCollapsed = ref(false)

  const isRunning = computed(() => {
    const id = sessionStore.activeSessionId
    return id ? sessionRuns.value.has(id) : false
  })

  const runningSessionId = computed(() => {
    const id = sessionStore.activeSessionId
    if (id && sessionRuns.value.has(id)) return id
    return null
  })

  const queuedMessages = computed(() => {
    const id = sessionStore.activeSessionId
    if (!id) return []
    return messageQueues.value.get(id) ?? []
  })

  const pendingConfirm = ref<{
    agentSessionId: string
    chatSessionId: string
    replyId: string
    toolCalls: AgentScopeToolCallInfo[]
  } | null>(null)

  const messages = computed<ChatMessage[]>(() => sessionStore.activeSession?.messages ?? [])
  const hasStreaming = computed(() => streamingParts.value.length > 0)
  /** 展示用消息列表：流式进行中时隐藏与 live 视图重复的 assistant 草稿 */
  const displayMessages = computed(() => {
    const list = messages.value
    const liveId = streamingMessageId.value
    if (!hasStreaming.value || !liveId) return list
    return list.filter((msg) => msg.id !== liveId)
  })

  const showPendingConfirm = computed(() =>
    pendingConfirm.value !== null
    && pendingConfirm.value.chatSessionId === sessionStore.activeSessionId
  )

  function syncActiveRunView(): void {
    const activeId = sessionStore.activeSessionId
    const run = activeId ? sessionRuns.value.get(activeId) : undefined
    if (!run) {
      streamingParts.value = []
      streamingMessageId.value = null
      inFlightRun.value = null
      if (!pendingConfirm.value || pendingConfirm.value.chatSessionId !== activeId) {
        pendingConfirm.value = null
      }
      if (!isRunning.value) {
        loopState.value = { status: 'idle', currentStep: 0, maxSteps: settingsStore.maxAgentSteps }
        activePlan.value = null
      }
      return
    }
    loopState.value = run.loopState
    pendingConfirm.value = run.pendingConfirm
    activePlan.value = run.activePlan
    planCollapsed.value = run.planCollapsed
    streamingMessageId.value = run.messageId
    inFlightRun.value = { chatSessionId: run.sessionId, messageId: run.messageId, parts: run.parts }
    streamingParts.value = syncViewParts(streamingParts.value, run.parts)
  }

  watch(
    () => sessionStore.activeSessionId,
    () => {
      syncActiveRunView()
    }
  )

  function enqueueMessage(
    sessionId: string,
    userText: string,
    agentText: string,
    options: SendMessageOptions,
    attachments: ComposerAttachment[]
  ): void {
    const queue = messageQueues.value.get(sessionId) ?? []
    queue.push({
      id: crypto.randomUUID(),
      userText,
      agentText,
      options,
      attachments: attachments.map(({ path, name, kind, mimeType, previewUrl }) => ({
        path,
        name,
        kind,
        mimeType,
        previewUrl
      }))
    })
    messageQueues.value.set(sessionId, queue)
    input.value = ''
    if (options.includeComposerAttachments !== false) {
      uiStore.clearComposerAttachments()
    }
    logger.info('chat message queued', { sessionId, queueLength: queue.length })
  }

  async function runNextQueued(sessionId: string): Promise<void> {
    if (sessionRuns.value.has(sessionId)) return
    const queue = messageQueues.value.get(sessionId)
    const next = queue?.shift()
    if (!queue?.length) messageQueues.value.delete(sessionId)
    if (!next) return
    if (sessionStore.activeSessionId !== sessionId) {
      await executeSendMessage(sessionId, next.userText, next.agentText, next.options, next.attachments)
      return
    }
    input.value = next.userText
    await sendMessage(next.options)
  }

  function accumulateUsageForRun(runState: SessionRunState, input: number, output: number): void {
    const usage: TokenUsage = runState.loopState.usage ?? { inputTokens: 0, outputTokens: 0 }
    runState.loopState.usage = {
      inputTokens: input || usage.inputTokens,
      outputTokens: usage.outputTokens + output
    }
    syncRunUiFromState(runState)
  }

  function syncRunUiFromState(runState: SessionRunState): void {
    if (sessionStore.activeSessionId !== runState.sessionId) return
    loopState.value = runState.loopState
    pendingConfirm.value = runState.pendingConfirm
    activePlan.value = runState.activePlan
    planCollapsed.value = runState.planCollapsed
  }

  async function syncMessages(next: ChatMessage[]): Promise<void> {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) return
    await sessionStore.updateSessionMessages(sessionId, next)
  }

  async function addMessage(msg: ChatMessage): Promise<void> {
    await syncMessages([...messages.value, msg])
  }

  async function sendMessage(options: SendMessageOptions = {}): Promise<void> {
    if (!input.value.trim() && uiStore.composerAttachments.length === 0) return

    const userText = input.value.trim() || tGlobal('chat.defaultAttachmentPrompt')
    const agentText = `${options.promptPrefix ?? ''}${userText}`
    const includeComposerAttachments = options.includeComposerAttachments ?? true
    const requestAttachments = includeComposerAttachments
      ? uiStore.composerAttachments.map((item) => ({ ...item }))
      : []
    const session = await sessionStore.ensureActiveSession()

    if (sessionRuns.value.has(session.id)) {
      enqueueMessage(session.id, userText, agentText, options, requestAttachments)
      return
    }

    await executeSendMessage(session.id, userText, agentText, options, requestAttachments)
  }

  async function executeSendMessage(
    sessionId: string,
    userText: string,
    agentText: string,
    options: SendMessageOptions,
    requestAttachments: ComposerAttachment[]
  ): Promise<void> {
    await sessionStore.loadSessionMessages(sessionId)
    const summary = sessionStore.summaries.find((item) => item.id === sessionId)
    if (!summary) {
      logger.warn('chat send skipped: unknown session', { sessionId })
      return
    }

    const includeComposerAttachments = options.includeComposerAttachments ?? true
    await sessionStore.touchSession(sessionId)
    const runId = crypto.randomUUID()
    let runtime: ReturnType<typeof useAgentRuntimeStore> | null = null
    let runtimeEventId: string | null = null
    let runtimeTurnId: string | null = null
    const runtimeSource = options.runtimeSource ?? 'chat'

    if ((ipc as { agentRuntime?: unknown }).agentRuntime) {
      try {
        runtime = useAgentRuntimeStore()
        const runtimeItem = await runtime.enqueue({
          source: runtimeSource,
          title: options.runtimeTitle ?? summary.title ?? userText.slice(0, 40),
          detail: userText.slice(0, 500),
          priority: options.runtimePriority ?? (runtimeSource === 'task' ? 80 : runtimeSource === 'browser' ? 65 : 55),
          metadata: {
            kind: `${runtimeSource}_turn`,
            sessionId,
            workspacePath: projectStore.activeProject?.rootPath,
            hasAttachments: requestAttachments.length > 0,
            ...options.runtimeMetadata
          }
        })
        runtimeEventId = runtimeItem.id
        const runtimeContext = await runtime.buildContext({
          text: agentText,
          sessionId: sessionId,
          workspacePath: projectStore.activeProject?.rootPath,
          maxChars: options.contextMaxChars ?? Math.min(settingsStore.maxContextTokens * 2, 6000),
          source: runtimeSource,
          turnId: runId
        })
        runtimeTurnId = runtimeContext.turnId
        await runtime.updateEvent({
          id: runtimeEventId,
          status: 'running',
          metadata: {
            turnId: runtimeTurnId,
            intent: runtimeContext.intent.primary,
            contextManifestId: runtimeContext.manifest.id,
            contextUsedChars: runtimeContext.usedChars,
            contextBudgetChars: runtimeContext.budgetChars
          }
        })
      } catch (error) {
        logger.debug('runtime turn registration skipped', { sessionId: sessionId, error })
      }
    }

    // 捕获随本条消息发送的图片附件（在 composer 清空前），用于气泡回显与持久化
    const messageImages = requestAttachments
      .filter((item) => item.kind === 'image')
      .map((item) => ({ path: item.path, name: item.name, previewUrl: item.previewUrl }))
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      meta: messageImages.length ? { images: messageImages } : undefined
    }
    await sessionStore.appendMessageToSession(sessionId, userMsg)
    if (sessionStore.activeSessionId === sessionId) {
      input.value = ''
      if (options.includeComposerAttachments !== false) {
        uiStore.clearComposerAttachments()
      }
    }

    const assistantId = crypto.randomUUID()
    const parts: MessagePart[] = []
    const runState: SessionRunState = {
      sessionId: sessionId,
      messageId: assistantId,
      parts,
      abortController: new AbortController(),
      loopState: { status: 'running', currentStep: 0, maxSteps: settingsStore.maxAgentSteps },
      pendingConfirm: null,
      activePlan: uiStore.planMode ? null : activePlan.value,
      planCollapsed: uiStore.planMode ? false : planCollapsed.value
    }
    sessionRuns.value.set(sessionId, runState)
    syncActiveRunView()
    let usedTools = false
    let errored = false
    let incomplete = false
    let finishedStatus: AgentLoopState['status'] = 'running'
    let assistantText = ''

    const tryUpdatePlan = () => {
      if (!uiStore.planMode || !assistantText.trim()) return
      const parsed = parsePlanFromText(assistantText, runState.activePlan?.id)
      if (!parsed) return
      if (!runState.activePlan) {
        runState.activePlan = markPlanRunning(parsed)
      } else if (parsed.steps.length >= runState.activePlan.steps.length) {
        runState.activePlan = { ...parsed, steps: parsed.steps.map((step, i) => ({
          ...step,
          status: runState.activePlan!.steps[i]?.status ?? step.status
        })) }
      }
      if (sessionStore.activeSessionId === sessionId) {
        activePlan.value = runState.activePlan
      }
    }

    const syncView = () => {
      if (sessionStore.activeSessionId === sessionId) {
        // 增量装配：复用未变片段身份，避免每帧整树深拷贝 + 无谓子组件重渲染
        streamingParts.value = syncViewParts(streamingParts.value, parts)
      }
    }

    let syncRaf: number | null = null
    const scheduleSyncView = () => {
      if (syncRaf !== null) return
      syncRaf = requestAnimationFrame(() => {
        syncRaf = null
        syncView()
      })
    }

    let persistTimer: ReturnType<typeof setTimeout> | null = null
    let persistChain: Promise<void> = Promise.resolve()

    const buildAssistantMessage = (meta: ChatMessage['meta']): ChatMessage => ({
      id: assistantId,
      role: 'assistant',
      content: partsToPlainText(parts),
      parts: snapshotParts(parts),
      timestamp: Date.now(),
      meta
    })

    const persistStreaming = (meta: ChatMessage['meta']) => {
      persistChain = persistChain.then(async () => {
        await sessionStore.upsertMessageToSession(sessionId, buildAssistantMessage(meta))
      }).catch((error) => {
        logger.debug('streaming persist failed', { sessionId: sessionId, error })
      })
      return persistChain
    }

    const schedulePersistStreaming = () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        void persistStreaming({ streaming: true })
      }, 1500)
    }

    void persistStreaming({ streaming: true })
    logger.info('start chat run', {
      sessionId: sessionId,
      approvalMode: projectStore.approvalMode
    })

    try {
      try {
        await runAgentScope(agentText, {
          requestId: runId,
          signal: runState.abortController.signal,
          approvalMode: projectStore.approvalMode,
          conversationId: sessionId,
          agentMode: 'chat',
          attachments: requestAttachments,
          referenceContextOnly: options.referenceContextOnly,
          referenceMessage: options.referenceMessage ?? userText,
          includeComposerAttachments,
          runtimeSource,
          onEvent: (event: AgentRunnerEvent) => {
            switch (event.type) {
              case 'text':
                appendText(parts, event.content)
                assistantText += event.content
                tryUpdatePlan()
                scheduleSyncView()
                schedulePersistStreaming()
                break

              case 'thinking':
                appendThinking(parts, event.content)
                scheduleSyncView()
                schedulePersistStreaming()
                break

              case 'tool_call':
                usedTools = true
                parts.push({
                  type: 'tool',
                  id: event.id,
                  name: event.name,
                  output: '',
                  status: 'running'
                })
                runState.loopState.currentStep += 1
                syncRunUiFromState(runState)
                schedulePersistStreaming()
                break

              case 'tool_args': {
                const part = findToolPart(parts, event.id)
                if (part) part.input = event.input
                syncView()
                schedulePersistStreaming()
                break
              }

              case 'tool_output': {
                const part = findToolPart(parts, event.id)
                if (part) part.output += event.delta
                scheduleSyncView()
                schedulePersistStreaming()
                break
              }

              case 'tool_end': {
                const part = findToolPart(parts, event.id)
                if (part && part.status === 'running') {
                  part.status = event.status
                  part.errorSummary = event.errorSummary
                  part.recoverySuggestion = event.recoverySuggestion
                }
                if (event.status === 'success' && activePlan.value) {
                  activePlan.value = advancePlanOnToolDone(activePlan.value)
                }
                syncView()
                schedulePersistStreaming()
                break
              }

              case 'tool_recovery': {
                const part = findToolPart(parts, event.id)
                if (part) {
                  part.retryOf = event.previousId
                  part.attempt = event.attempt
                }
                syncView()
                schedulePersistStreaming()
                break
              }

              case 'tool_retry_mark': {
                const part = findToolPart(parts, event.id)
                if (part) part.retryAttempted = true
                syncView()
                schedulePersistStreaming()
                break
              }

              case 'confirm_required':
                runState.loopState.status = 'waiting_confirm'
                runState.pendingConfirm = {
                  agentSessionId: event.sessionId,
                  chatSessionId: sessionId,
                  replyId: event.replyId,
                  toolCalls: event.toolCalls
                }
                syncRunUiFromState(runState)
                syncView()
                break

              case 'tokens':
                accumulateUsageForRun(runState, event.input, event.output)
                break

              case 'done':
                runState.loopState.status = incomplete ? 'incomplete' : 'done'
                if (runState.activePlan && runState.activePlan.status === 'running') {
                  runState.activePlan = {
                    ...runState.activePlan,
                    status: 'done',
                    steps: runState.activePlan.steps.map((s) => ({ ...s, status: 'done' as const }))
                  }
                }
                syncRunUiFromState(runState)
                break

              case 'max_steps':
                incomplete = true
                appendText(parts, `\n\n> ${event.message}`)
                runState.loopState.status = 'incomplete'
                syncRunUiFromState(runState)
                syncView()
                schedulePersistStreaming()
                break

              case 'error':
                errored = true
                appendText(parts, `\n\n> ${tGlobal('chat.errorPrefix', { message: event.error })}`)
                runState.loopState.status = 'error'
                syncRunUiFromState(runState)
                syncView()
                schedulePersistStreaming()
                break
            }
          }
        })
      } catch (e) {
        errored = true
        logger.error('chat run failed', { sessionId: sessionId, error: e })
        if (parts.length === 0) appendText(parts, tGlobal('chat.errorSimple', { message: String(e) }))
        runState.loopState.status = 'error'
        syncRunUiFromState(runState)
      }

      // 标记所有未结束的工具为中断态（如用户停止）
      for (const part of parts) {
        if (part.type === 'tool' && part.status === 'running') {
          part.status = errored ? 'error' : 'rejected'
        }
      }

      const hasAnswerText = parts.some((p) => p.type === 'text' && p.text.trim())
      const hasNonAnswerWork = parts.some((p) => p.type === 'tool' || p.type === 'thinking')
      if (hasNonAnswerWork && !hasAnswerText && !errored && runState.loopState.status !== 'stopped') {
        incomplete = true
        appendText(parts, tGlobal('chat.missingFinalAnswer'))
        runState.loopState.status = 'incomplete'
        syncRunUiFromState(runState)
      }

      // 零输出兜底：回合正常结束但模型既没文本也没工具，给出可见提示而非静默无响应
      const hasContent = parts.some(
        (p) => (p.type === 'text' && p.text.trim()) || p.type === 'tool' || p.type === 'thinking'
      )
      if (!hasContent && !errored && runState.loopState.status !== 'stopped') {
        appendText(
          parts,
          tGlobal('chat.emptyModelResponse')
        )
        runState.loopState.status = 'error'
        syncRunUiFromState(runState)
      }

      if (parts.length > 0) {
        if (persistTimer) {
          clearTimeout(persistTimer)
          persistTimer = null
        }
        const incompleteMeta = incomplete || errored || runState.loopState.status === 'stopped' || runState.loopState.status === 'incomplete'
        const runSummary = buildAgentRunSummary(parts)
        const finalMeta = incompleteMeta
          ? { streaming: false, incomplete: true, runSummary }
          : { streaming: false, runSummary }
        // 先结束 live 视图，再落盘最终消息，避免与列表中的同 id 消息短暂双显
        streamingParts.value = []
        await persistStreaming(finalMeta)
        finishedStatus = runState.loopState.status
      }
    } finally {
      if (runtime && runtimeEventId) {
        const status: AgentRuntimeEventStatus = errored || runState.loopState.status === 'error'
          ? 'failed'
          : runState.loopState.status === 'stopped' || runState.loopState.status === 'incomplete'
            ? 'skipped'
            : 'done'
        await runtime.updateEvent({
          id: runtimeEventId,
          status,
          detail: partsToPlainText(parts).slice(0, 500) || userText.slice(0, 500),
          metadata: {
            turnId: runtimeTurnId,
            finalStatus: runState.loopState.status,
            partCount: parts.length,
            usedTools
          }
        }).catch((error) => {
          logger.debug('runtime turn finish skipped', { sessionId, error })
        })
      }
      logger.info('finish chat run', {
        sessionId,
        status: runState.loopState.status,
        partCount: parts.length
      })
      const shouldRunQueue = runState.loopState.status !== 'stopped'
      const preservedLoopState: AgentLoopState = { ...runState.loopState }
      if (preservedLoopState.status === 'running' || preservedLoopState.status === 'waiting_confirm') {
        preservedLoopState.status = 'idle'
      }
      sessionRuns.value.delete(sessionId)
      if (sessionStore.activeSessionId === sessionId) {
        streamingParts.value = []
        streamingMessageId.value = null
        inFlightRun.value = null
        pendingConfirm.value = null
        loopState.value = preservedLoopState
      } else {
        syncActiveRunView()
      }
      void sessionStore.touchSession(sessionId)
      if (shouldRunQueue) {
        void runNextQueued(sessionId)
      }
    }

    if (parts.length > 0 && finishedStatus === 'done') {
      const content = partsToPlainText(parts)
      if (content) {
        void unwrap(
          ipc.memory.capture({
            sessionId,
            workspacePath: useProjectStore().activeProject?.rootPath,
            userMessage: userText,
            assistantMessage: content,
            usedTools
          })
        )
      }
      void refreshTitleAfterRun(sessionId, userText, content)
    }
  }

  async function refreshTitleAfterRun(sessionId: string, userText: string, assistantText: string): Promise<void> {
    if (!sessionStore.canApplyAutoTitle(sessionId)) return
    try {
      const title = await summarizeAgentTitle({
        userMessage: userText,
        assistantText,
        workspaceName: projectStore.activeProject?.name,
        locale: String(i18n.global.locale.value)
      })
      await sessionStore.applyAutoTitle(sessionId, title)
      logger.info('chat title summarized', { sessionId })
    } catch (error) {
      logger.debug('chat title summarize failed, use local fallback', { sessionId, error })
      await sessionStore.applyAutoTitle(sessionId, userText)
    }
  }

  function confirmTools(approved: boolean): void {
    if (!pendingConfirm.value) return
    const { agentSessionId, replyId, toolCalls, chatSessionId } = pendingConfirm.value
    const run = sessionRuns.value.get(chatSessionId)
    const parts = run?.parts ?? inFlightRun.value?.parts
    confirmAgentTools(
      agentSessionId,
      replyId,
      toolCalls.map((tc) => ({ toolCallId: tc.id, confirmed: approved }))
    )
    // 用户拒绝时，将对应工具卡片置为已拒绝
    if (!approved && parts) {
      for (const tc of toolCalls) {
        const part = findToolPart(parts, tc.id)
        if (part && part.status === 'running') part.status = 'rejected'
      }
      if (sessionStore.activeSessionId === chatSessionId) {
        streamingParts.value = snapshotParts(parts)
      }
    }
    if (run) {
      run.pendingConfirm = null
      run.loopState.status = 'running'
      syncRunUiFromState(run)
    } else {
      pendingConfirm.value = null
      loopState.value.status = 'running'
    }
  }

  function stopAgent(): void {
    const activeId = sessionStore.activeSessionId
    if (!activeId) return
    const run = sessionRuns.value.get(activeId)
    if (!run) return
    logger.info('stop chat run requested', { sessionId: activeId })
    run.abortController.abort()
    run.loopState.status = 'stopped'
    syncRunUiFromState(run)
  }

  function clearInput(): void {
    input.value = ''
  }

  function abortIfRunning(): void {
    if (isRunning.value) stopAgent()
  }

  return {
    messages,
    displayMessages,
    input,
    isRunning,
    loopState,
    pendingConfirm,
    showPendingConfirm,
    streamingParts,
    streamingMessageId,
    hasStreaming,
    runningSessionId,
    queuedMessages,
    activePlan,
    planCollapsed,
    sendMessage,
    confirmTools,
    stopAgent,
    clearInput,
    abortIfRunning,
    addMessage
  }
})
