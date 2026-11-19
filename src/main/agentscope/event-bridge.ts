import { EventType, type AgentEvent } from '@agentscope-ai/agentscope/event'
import type { AgentScopeEvent, AgentScopeToolCallInfo } from '../../shared/types/agentscope.js'

/**
 * event-bridge.ts — AgentScope 事件 → IPC 事件映射模块
 *
 * 职责：将 AgentScope SDK 的 `AgentEvent` 原生事件对象转换为 IPC 通道友好的
 *       `AgentScopeEvent` 扁平格式，供渲染进程消费。
 *
 * 设计要点：
 * - 保留 `tool_call_id` 贯穿工具调用的全生命周期（start → delta → end →
 *   result_start → result_delta → result_end），使渲染进程能将流式输出
 *   关联到同一张工具调用卡片。
 * - 对于不关心的内部事件（如模型中间状态）返回 null，由调用方过滤。
 *
 * 映射关系：见下方 switch 各 case 的详细说明。
 */

/**
 * 将 AgentScope 原生事件映射为 IPC 友好格式。
 *
 * @param sessionId - 当前会话 ID，由调用方传入，用于渲染进程关联事件流
 * @param event     - AgentScope SDK 原生事件对象
 * @returns 扁平化的 AgentScopeEvent，或 null（跳过该事件）
 */
export function mapAgentEvent(sessionId: string, event: AgentEvent): AgentScopeEvent | null {
  switch (event.type) {
    // ── 回复生命周期 ──────────────────────────────────────────
    // 模型开始/结束生成一条完整回复
    case EventType.REPLY_START:
      return { type: 'reply_start', sessionId, replyId: event.reply_id }

    case EventType.REPLY_END:
      return { type: 'reply_end', sessionId, replyId: event.reply_id }

    // ── 文本流式输出 ──────────────────────────────────────────
    // 模型逐字生成的文本片段（delta）及结束标记
    case EventType.TEXT_BLOCK_DELTA:
      return { type: 'text_delta', sessionId, replyId: event.reply_id, delta: event.delta }

    case EventType.TEXT_BLOCK_END:
      return { type: 'text_end', sessionId, replyId: event.reply_id }

    // ── 思考过程流式输出 ──────────────────────────────────────
    // 类似 DeepSeek reasoning_content 的逐字流式输出
    case EventType.THINKING_BLOCK_DELTA:
      return { type: 'thinking_delta', sessionId, replyId: event.reply_id, delta: event.delta }

    // ── 工具调用生命周期 ──────────────────────────────────────
    // start: 模型决定调用某工具（含工具名）
    case EventType.TOOL_CALL_START:
      return {
        type: 'tool_call_start',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id,
        toolName: event.tool_call_name
      }

    // delta: 模型逐字流式输出工具入参 JSON 片段
    case EventType.TOOL_CALL_DELTA:
      return {
        type: 'tool_call_delta',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id,
        delta: event.delta
      }

    // end: 工具入参 JSON 传输完毕
    case EventType.TOOL_CALL_END:
      return {
        type: 'tool_call_end',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id
      }

    // ── 工具执行结果生命周期 ──────────────────────────────────
    // result_start: 工具开始执行（含工具名，可能和 start 不同名）
    case EventType.TOOL_RESULT_START:
      return {
        type: 'tool_result_start',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id,
        toolName: event.tool_call_name
      }

    // result_delta: 工具执行结果文本逐段流出
    case EventType.TOOL_RESULT_TEXT_DELTA:
      return {
        type: 'tool_result_delta',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id,
        delta: event.delta
      }

    // result_end: 工具执行结束（含执行状态 state）
    case EventType.TOOL_RESULT_END:
      return {
        type: 'tool_result_end',
        sessionId,
        replyId: event.reply_id,
        toolCallId: event.tool_call_id,
        state: event.state
      }

    // ── Human-in-the-Loop ─────────────────────────────────────
    // 模型请求用户确认工具调用（如 Bash/Write 等高危操作）
    case EventType.REQUIRE_USER_CONFIRM:
      return {
        type: 'require_confirm',
        sessionId,
        replyId: event.reply_id,
        toolCalls: event.tool_calls.map(mapToolCallBlock)
      }

    // ── 异常/限制 ─────────────────────────────────────────────
    // 模型调用次数超过 maxIters 上限
    case EventType.EXCEED_MAX_ITERS:
      return { type: 'exceed_max_iters', sessionId, replyId: event.reply_id }

    // ── 计量信息 ─────────────────────────────────────────────
    // 模型调用结束时的 token 消耗统计
    case EventType.MODEL_CALL_END:
      return {
        type: 'model_call_end',
        sessionId,
        replyId: event.reply_id,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens
      }

    default:
      // 未识别的事件类型：静默跳过（不中断流）
      return null
  }
}

function mapToolCallBlock(tc: { id: string; name: string; input?: string | Record<string, unknown> }): AgentScopeToolCallInfo {
  let input: Record<string, unknown> = {}
  if (typeof tc.input === 'string') {
    try { input = JSON.parse(tc.input) as Record<string, unknown> } catch { input = { raw: tc.input } }
  } else if (tc.input) {
    input = tc.input
  }
  return { id: tc.id, name: tc.name, input }
}
