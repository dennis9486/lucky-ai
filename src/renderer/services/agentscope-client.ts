import type { AgentMode, AgentScopeEvent, AgentTitleSummaryRequest } from '../../shared/types/agentscope.js'
import type { AgentRuntimeEventSource } from '../../shared/types/agent-runtime.js'
import type { ApprovalMode } from '../../shared/types/conversation.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import type { ComposerAttachment } from '../stores/ui.store.js'
import { ipc } from './ipc-client.js'
import { buildContext, buildImageAttachments, buildReferenceContext } from './context-builder.js'
import { tGlobal } from '../i18n/index.js'

export type AgentRunnerEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  /** 工具开始：创建一张工具卡片 */
  | { type: 'tool_call'; id: string; name: string }
  /** 工具入参解析完成 */
  | { type: 'tool_args'; id: string; input: Record<string, unknown> }
  /** 工具结果流式增量 */
  | { type: 'tool_output'; id: string; delta: string }
  /** 工具结束（终态）；rejected = 用户拒绝执行或轮次中断 */
  | {
      type: 'tool_end'
      id: string
      status: 'success' | 'error' | 'rejected'
      errorSummary?: string
      recoverySuggestion?: string
    }
  | { type: 'tool_recovery'; id: string; previousId: string; attempt: number }
  | { type: 'tool_retry_mark'; id: string }
  | {
      type: 'confirm_required'
      sessionId: string
      replyId: string
      toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    }
  | { type: 'tokens'; input: number; output: number }
  | { type: 'done' }
  | { type: 'max_steps'; message: string }
  | { type: 'error'; error: string }

export interface AgentRunnerOptions {
  onEvent: (event: AgentRunnerEvent) => void
  /** 主进程会话 id（= 文件前像 turn_id）确定后回调一次，供 UI 关联按轮回滚 */
  onSessionId?: (sessionId: string) => void
  /** 预生成的 run id，与 runtime 观测 turnId 对齐 */
  requestId?: string
  signal?: AbortSignal
  approvalMode?: ApprovalMode
  conversationId?: string
  /** 跳过完整工作区上下文，仅附加 @ 引用与图片（Code Agent 已自带 prompt） */
  referenceContextOnly?: boolean
  /** 是否从 composer 附件读取图片，Code Agent 使用独立附件列表时应设为 false */
  includeComposerAttachments?: boolean
  /** 显式附件列表。Code Agent 使用自己的附件池，避免与 Chat composer 状态混用。 */
  attachments?: ComposerAttachment[]
  /** 用于解析 @ 引用和图片的原始用户输入；Code Agent 的 message 会被包装成完整系统提示词。 */
  referenceMessage?: string
  /** 明确区分 Chat Agent 与 Code Agent，主进程据此注入不同内置 skill。 */
  agentMode?: AgentMode
  /** Runtime/Manifest 来源，仅用于观测与上下文审计；Code Agent 仍走独立 agentMode。 */
  runtimeSource?: AgentRuntimeEventSource
}

const logger = createLogger('renderer/agent', {
  debugEnabled: () => {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } }
    return Boolean(meta.env?.DEV)
  }
})

/**
 * AgentScope 驱动器 — 渲染进程侧编排。
 *
 * 通过 IPC 接收主进程的细粒度事件流，在此累积工具入参的流式 JSON 片段，
 * 并将其归一化为结构化的工具生命周期事件供 UI 渲染。
 */
export async function runAgentScope(userMessage: string, options: AgentRunnerOptions): Promise<void> {
  const referenceMessage = options.referenceMessage ?? userMessage
  const context = options.referenceContextOnly
    ? await buildReferenceContext(referenceMessage, options.attachments)
    : await buildContext(userMessage, options.conversationId, options.attachments, options.runtimeSource ?? 'chat')
  const images = buildImageAttachments(
    referenceMessage,
    options.includeComposerAttachments !== false,
    options.attachments
  )
  let sessionId = ''
  let settled = false
  let sessionAnnounced = false

  // 会话 id 可能先由事件流带回（preload 先订阅后 invoke），也可能由 invoke 结果带回，只回调一次
  const announceSession = (id: string) => {
    if (sessionAnnounced || !id) return
    sessionAnnounced = true
    options.onSessionId?.(id)
  }

  // tool_call_id -> 累积的入参 JSON 文本（来自 tool_call_delta）
  const argBuffers = new Map<string, string>()
  // 已知工具名（用于结果事件回填与补建卡片）
  const toolNames = new Map<string, string>()
  const toolInputs = new Map<string, Record<string, unknown>>()
  const outputBuffers = new Map<string, string>()
  const signatures = new Map<string, string>()
  const failedBySignature = new Map<string, { id: string; attempt: number }>()
  const currentAttempts = new Map<string, number>()

  logger.info('start agent run', {
    conversationId: options.conversationId,
    approvalMode: options.approvalMode,
    referenceContextOnly: Boolean(options.referenceContextOnly),
    contextLength: context.length,
    imageCount: images.length,
    agentMode: options.agentMode ?? 'chat',
    runtimeSource: options.runtimeSource ?? 'chat'
  })

  return new Promise((resolve, reject) => {
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const emitArgs = (id: string) => {
      const raw = argBuffers.get(id)
      if (raw === undefined) return
      argBuffers.delete(id)
      const input = parseToolInput(raw)
      toolInputs.set(id, input)
      const signature = buildToolSignature(toolNames.get(id) ?? '', input)
      signatures.set(id, signature)
      const failed = failedBySignature.get(signature)
      if (failed) {
        failedBySignature.delete(signature)
        currentAttempts.set(id, failed.attempt + 1)
        options.onEvent({ type: 'tool_retry_mark', id: failed.id })
        options.onEvent({ type: 'tool_recovery', id, previousId: failed.id, attempt: failed.attempt + 1 })
      }
      options.onEvent({ type: 'tool_args', id, input })
    }

    void ipc.agent.send({
      requestId: options.requestId,
      conversationId: options.conversationId,
      message: userMessage,
      context,
      images,
      approvalMode: options.approvalMode,
      agentMode: options.agentMode ?? 'chat'
    }, (evt: AgentScopeEvent) => {
      if (settled) return

      if (!sessionId) sessionId = evt.sessionId
      announceSession(evt.sessionId)

      if (evt.type === 'error') {
        logger.error('agent event error', {
          sessionId: evt.sessionId,
          error: evt.error
        })
      } else if (evt.type === 'reply_end') logger.debug('reply end', { sessionId: evt.sessionId })
      else if (evt.type !== 'text_delta' && evt.type !== 'tool_call_delta' && evt.type !== 'tool_result_delta') {
        logger.debug('agent event', {
          sessionId: evt.sessionId,
          type: evt.type,
          toolName: evt.toolName
        })
      }

      switch (evt.type) {
        case 'text_delta':
          if (evt.delta) options.onEvent({ type: 'text', content: evt.delta })
          break

        case 'thinking_delta':
          if (evt.delta) options.onEvent({ type: 'thinking', content: evt.delta })
          break

        case 'tool_call_start':
          if (evt.toolCallId) {
            toolNames.set(evt.toolCallId, evt.toolName ?? '')
            argBuffers.set(evt.toolCallId, '')
            options.onEvent({ type: 'tool_call', id: evt.toolCallId, name: evt.toolName ?? '' })
          }
          break

        case 'tool_call_delta':
          if (evt.toolCallId && evt.delta) {
            argBuffers.set(evt.toolCallId, (argBuffers.get(evt.toolCallId) ?? '') + evt.delta)
          }
          break

        case 'tool_call_end':
          if (evt.toolCallId) emitArgs(evt.toolCallId)
          break

        case 'tool_result_start':
          // 若先前未见过 tool_call_start（极少数实现差异），补建卡片
          if (evt.toolCallId && !toolNames.has(evt.toolCallId)) {
            toolNames.set(evt.toolCallId, evt.toolName ?? '')
            options.onEvent({ type: 'tool_call', id: evt.toolCallId, name: evt.toolName ?? '' })
          }
          break

        case 'tool_result_delta':
          if (evt.toolCallId && evt.delta) {
            outputBuffers.set(evt.toolCallId, (outputBuffers.get(evt.toolCallId) ?? '') + evt.delta)
            options.onEvent({ type: 'tool_output', id: evt.toolCallId, delta: evt.delta })
          }
          break

        case 'tool_result_end':
          if (evt.toolCallId) {
            // interrupted/denied（用户拒绝或轮次中断）不能记成 success——
            // 否则被拒的高危操作在 UI/导出里看起来像执行成功了
            const status = evt.state === 'error'
              ? 'error'
              : evt.state === 'interrupted' || evt.state === 'denied'
                ? 'rejected'
                : 'success'
            const output = outputBuffers.get(evt.toolCallId) ?? ''
            const errorSummary = status === 'error' ? summarizeToolError(output) : undefined
            const recoverySuggestion = status === 'error'
              ? buildRecoverySuggestion(toolNames.get(evt.toolCallId) ?? '', toolInputs.get(evt.toolCallId), errorSummary)
              : undefined
            options.onEvent({
              type: 'tool_end',
              id: evt.toolCallId,
              status,
              errorSummary,
              recoverySuggestion
            })
            if (status === 'error') {
              const signature = signatures.get(evt.toolCallId)
              if (signature) {
                const prior = failedBySignature.get(signature)
                failedBySignature.set(signature, {
                  id: evt.toolCallId,
                  attempt: Math.max(prior?.attempt ?? 0, currentAttempts.get(evt.toolCallId) ?? 1)
                })
              }
            }
          }
          break

        case 'require_confirm':
          if (evt.replyId && evt.toolCalls) {
            // 确认事件已携带完整入参，直接回填到对应卡片
            for (const tc of evt.toolCalls) {
              options.onEvent({ type: 'tool_args', id: tc.id, input: tc.input })
            }
            options.onEvent({
              type: 'confirm_required',
              sessionId: evt.sessionId,
              replyId: evt.replyId,
              toolCalls: evt.toolCalls
            })
          }
          break

        case 'model_call_end':
          options.onEvent({
            type: 'tokens',
            input: evt.inputTokens ?? 0,
            output: evt.outputTokens ?? 0
          })
          break

        case 'reply_end':
          options.onEvent({ type: 'done' })
          logger.info('agent run completed', { sessionId: evt.sessionId })
          finish()
          break

        case 'error':
          {
            const error = classifyAgentError(evt.error ?? tGlobal('agent.unknownError'))
            options.onEvent({ type: 'error', error })
            fail(new Error(error))
          }
          break

        case 'exceed_max_iters':
          options.onEvent({ type: 'max_steps', message: tGlobal('chat.maxStepsReached') })
          logger.warn('agent run exceeded max iterations', { sessionId: evt.sessionId })
          finish()
          break
      }
    }).then((result: IpcResult<string>) => {
      logger.debug('ipc.agent.send resolved', {
        success: result.success,
        sessionId: result.data,
        error: result.error
      })
      if (!result.success || !result.data) {
        fail(new Error(result.error ?? tGlobal('agent.startFailed')))
        return
      }
      sessionId = result.data
      announceSession(sessionId)
      if (options.signal?.aborted) {
        logger.info('abort agent run before stream settles', { sessionId })
        void ipc.agent.abort(sessionId)
        finish()
      }
    }).catch((e: unknown) => {
      logger.error('ipc.agent.send rejected', { error: e, sessionId })
      fail(e instanceof Error ? e : new Error(String(e)))
    })

    options.signal?.addEventListener('abort', () => {
      logger.info('abort agent run', { sessionId: sessionId || undefined })
      if (sessionId) void ipc.agent.abort(sessionId)
      finish()
    }, { once: true })
  })
}

function classifyAgentError(message: string): string {
  const lower = message.toLowerCase()
  if (
    lower.includes('messages.content.type')
    || lower.includes('image_url')
    || lower.includes('vision')
    || lower.includes('multimodal')
  ) {
    return tGlobal('chat.errorVisionUnsupported', { message })
  }
  if (
    lower.includes('context length')
    || lower.includes('maximum context')
    || lower.includes('token')
    || lower.includes('too long')
  ) {
    return tGlobal('chat.errorContextTooLarge', { message })
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key')) {
    return tGlobal('chat.errorProviderAuth', { message })
  }
  if (lower.includes('timeout') || lower.includes('network') || lower.includes('econn')) {
    return tGlobal('chat.errorProviderNetwork', { message })
  }
  return message
}

function buildToolSignature(name: string, input: Record<string, unknown>): string {
  return `${name}:${stableStringify(input)}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function summarizeToolError(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const important = lines.find((line) => /error|failed|exception|denied|not found|no such|permission|timeout/i.test(line))
    ?? lines.at(-1)
    ?? ''
  return important.length > 220 ? `${important.slice(0, 220).trim()}...` : important
}

function buildRecoverySuggestion(name: string, input?: Record<string, unknown>, error?: string): string {
  const lower = `${name} ${error ?? ''}`.toLowerCase()
  if (lower.includes('permission') || lower.includes('denied')) {
    return tGlobal('tool.recoveryPermission')
  }
  if (lower.includes('not found') || lower.includes('no such')) {
    return tGlobal('tool.recoveryPath')
  }
  if (name === 'Bash') {
    const command = typeof input?.command === 'string' ? input.command : ''
    return command ? tGlobal('tool.recoveryCommand') : tGlobal('tool.recoveryGeneric')
  }
  return tGlobal('tool.recoveryGeneric')
}

/** 解析流式累积的工具入参 JSON；失败时保留原文便于排查 */
function parseToolInput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
  } catch {
    return { _raw: trimmed }
  }
}

export function confirmAgentTools(
  sessionId: string,
  replyId: string,
  results: Array<{ toolCallId: string; confirmed: boolean }>
): void {
  void ipc.agent.confirmAll(sessionId, replyId, results)
}

export async function summarizeAgentTitle(request: AgentTitleSummaryRequest): Promise<string> {
  const result = await ipc.agent.summarizeTitle(request)
  if (!result.success) throw new Error(result.error ?? tGlobal('agent.ipcFailed'))
  return result.data ?? ''
}
