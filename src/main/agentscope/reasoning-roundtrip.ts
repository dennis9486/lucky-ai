/**
 * reasoning-roundtrip.ts — DeepSeek 思考模式 reasoning_content 回传修复模块
 *
 * 问题背景：
 * DeepSeek 思考模型（如 deepseek-reasoner）在「思考 + 工具调用」场景下，
 * assistant 消息会包含 `reasoning_content` 字段。当发生工具调用后，后续每
 * 个请求必须把历史 assistant 消息中的 `reasoning_content` 原样回传，否则
 * DeepSeek 返回 400 "The reasoning_content in the thinking mode must be
 * passed back"。
 *
 * 解决方案：
 * agentscope 0.0.12 的 formatter 不输出 reasoning_content，因此本模块直接
 * 包装 OpenAI client 的 `chat.completions.create` 方法：
 *
 * 1. 拦截请求 — 遍历 messages 数组，找出所有缺少 reasoning_content 的
 *    assistant(tool_calls) 消息，从缓存中补回。
 * 2. 拦截响应 — 从真实响应（流式/非流式）中按 tool_call id 抓取
 *    reasoning_content 并缓存，供后续请求使用。
 *
 * 优势：直接作用于发往 API 的最终 JSON，不依赖 agentscope 的格式化/记忆行为，
 *        与任何上层框架解耦。
 *
 * 数据流：
 * model.call() → withSchemaSanitizer → withReasoningRoundTrip →
 *   → 补全请求消息中的 reasoning_content → OpenAI API →
 *   → 从响应中缓存 reasoning_content（按 tool_call_id 索引）
 */

import type { ChatModelBase } from '@agentscope-ai/agentscope/model'

/**
 * 助手消息的局部类型定义（仅关注 reasoning_content 相关字段）。
 */
interface AssistantMessageLike {
  role?: string
  tool_calls?: Array<{ id?: string }>
  reasoning_content?: unknown
}

/**
 * ChatModel 的类型结构，用于定位 client.chat.completions.create 方法。
 */
interface CompletionsHost {
  client?: {
    chat?: {
      completions?: {
        create?: (...args: unknown[]) => Promise<unknown>
      }
    }
  }
}

/**
 * 为 OpenAI-compatible ChatModel 注入 reasoning_content 回传修复。
 *
 * 工作原理：
 * 1. 从 model 对象中找到 `client.chat.completions.create` 方法。
 * 2. 替换为包装方法，在请求前注入缺失的 reasoning_content，在响应后缓存。
 * 3. 使用 `state` 对象维护跨请求的状态（byToolCallId 索引 + 历史轮次列表）。
 *
 * @param model - 待装饰的 ChatModelBase 实例
 * @returns 同一实例（mutated），completions.create 已注入修复逻辑。
 *          若无法定位 completions.create 方法则原样返回。
 */
export function withReasoningRoundTrip<T extends ChatModelBase>(model: T): T {
  const completions = (model as unknown as CompletionsHost).client?.chat?.completions
  const original = completions?.create
  if (!completions || typeof original !== 'function') return model

  // 初始化跨请求状态
  const state: ReasoningRoundTripState = {
    byToolCallId: new Map(),
    toolRounds: []
  }
  const boundOriginal = original.bind(completions) as (...args: unknown[]) => Promise<unknown>

  completions.create = async (...args: unknown[]): Promise<unknown> => {
    const params = args[0] as { messages?: AssistantMessageLike[]; stream?: boolean } | undefined

    // ── 请求前注入 ──────────────────────────────────────────
    // 遍历 messages，为每个带 tool_calls 但缺 reasoning_content 的
    // assistant 消息补回缓存中的思考内容
    let fallbackIndex = 0
    for (const msg of params?.messages ?? []) {
      if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls) || msg.reasoning_content != null) continue
      const matched = findReasoningForAssistantMessage(msg, state, fallbackIndex)
      const reasoning = matched?.reasoning
      if (reasoning) msg.reasoning_content = reasoning
      if (matched?.fromFallback) fallbackIndex = matched.index + 1
    }

    // ── 执行原始请求 ────────────────────────────────────────
    const result = await boundOriginal(...args)

    // ── 响应后缓存 ──────────────────────────────────────────
    if (params?.stream) {
      return wrapStream(result as AsyncIterable<unknown>, state)
    }
    captureFromCompletion(result, state)
    return result
  }

  return model
}

/**
 * roundtrip 修复的状态容器。
 */
interface ReasoningRoundTripState {
  /** 按 tool_call_id 索引的 reasoning_content 映射 */
  byToolCallId: Map<string, string>
  /** 按时间顺序记录的工具调用轮次（含所有 tool_call_id 和对应的 reasoning） */
  toolRounds: Array<{ toolCallIds: string[]; reasoning: string }>
}

/**
 * 为指定 assistant 消息查找对应的 reasoning_content。
 *
 * 查找策略（两阶段）：
 * 1. 精确匹配 — 遍历消息中的 tool_call.id，在 byToolCallId Map 中查找。
 *    如果找到，返回对应的 reasoning 及其在 toolRounds 中的索引。
 * 2. 回退匹配 — AgentScope/adapter 可能在迭代之间重建消息对象，导致
 *    tool_call_id 不完全一致。此时按时间顺序（chronological round order）
 *    回退，使用历史轮次的 reasoning。确保同一个请求中不会重复使用同一个
 *    回退轮次（通过 fallbackStartIndex 控制）。
 *
 * @param msg               - 待查找的 assistant 消息
 * @param state             - 当前 roundtrip 状态
 * @param fallbackStartIndex - 回退搜索起始索引（避免同一请求中重复使用）
 * @returns 找到的 reasoning 信息，或 null
 */
function findReasoningForAssistantMessage(
  msg: AssistantMessageLike,
  state: ReasoningRoundTripState,
  fallbackStartIndex: number
): { reasoning: string; fromFallback: boolean; index: number } | null {
  // Phase 1: 精确匹配 tool_call_id
  for (const call of msg.tool_calls ?? []) {
    const reasoning = call?.id ? state.byToolCallId.get(call.id) : undefined
    if (reasoning) {
      const index = state.toolRounds.findIndex((round) => round.reasoning === reasoning)
      return { reasoning, fromFallback: false, index }
    }
  }

  // Phase 2: 回退匹配（按时间顺序，不重复使用同一轮次）
  for (let index = fallbackStartIndex; index < state.toolRounds.length; index += 1) {
    const round = state.toolRounds[index]
    if (round) return { reasoning: round.reasoning, fromFallback: true, index }
  }

  return null
}

/**
 * 流式响应分片的局部类型（仅关注 reasoning_content 和 tool_calls）。
 */
interface StreamDelta {
  choices?: Array<{ delta?: { reasoning_content?: unknown; tool_calls?: Array<{ id?: unknown; index?: unknown }> } }>
}

/**
 * 透传流式分片的 AsyncGenerator 包装。
 *
 * 在逐块 yield 原始分片的同时：
 * 1. 累积 reasoning_content 文本。
 * 2. 记录每个 tool_call 的 id（按 index 索引）。
 * 3. 流结束后将 reasoning 与 tool_call_ids 关联存入 state。
 *
 * @param stream - 原始流式响应 AsyncIterable
 * @param state  - roundtrip 状态
 */
async function* wrapStream(
  stream: AsyncIterable<unknown>,
  state: ReasoningRoundTripState
): AsyncGenerator<unknown> {
  let reasoning = ''
  const toolIdByIndex = new Map<number, string>()

  for await (const chunk of stream) {
    const delta = (chunk as StreamDelta)?.choices?.[0]?.delta
    if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content
    if (Array.isArray(delta?.tool_calls)) {
      for (const call of delta.tool_calls) {
        if (call?.id != null && call?.index != null) {
          toolIdByIndex.set(Number(call.index), String(call.id))
        }
      }
    }
    yield chunk
  }

  // 流结束：如果累积了 reasoning，关联到该轮所有 tool_call_id 并缓存
  if (reasoning) {
    rememberToolRoundReasoning(reasoning, [...toolIdByIndex.values()], state)
  }
}

/**
 * 非流式完整响应中 message 部分的局部类型。
 */
interface CompletionLike {
  choices?: Array<{ message?: { reasoning_content?: unknown; tool_calls?: Array<{ id?: unknown }> } }>
}

/**
 * 非流式响应处理：从完整响应中抓取 reasoning_content。
 *
 * @param result - OpenAI API 的完整响应对象
 * @param state  - roundtrip 状态（将在此更新）
 */
function captureFromCompletion(result: unknown, state: ReasoningRoundTripState): void {
  const message = (result as CompletionLike)?.choices?.[0]?.message
  const reasoning = message?.reasoning_content
  if (typeof reasoning === 'string' && reasoning && Array.isArray(message?.tool_calls)) {
    rememberToolRoundReasoning(
      reasoning,
      message.tool_calls.map((call) => call?.id).filter((id): id is string | number => id != null).map(String),
      state
    )
  }
}

/**
 * 将一轮工具调用的 reasoning_content 记录到状态中。
 *
 * 同时更新两个索引：
 * 1. toolRounds — 按时间顺序的轮次列表（供回退匹配使用）。
 * 2. byToolCallId — 按 tool_call_id 的快速查找 Map。
 *
 * @param reasoning   - 该轮次的思考内容文本
 * @param toolCallIds - 该轮次中所有工具调用的 ID 列表
 * @param state       - roundtrip 状态（将在此更新）
 */
function rememberToolRoundReasoning(
  reasoning: string,
  toolCallIds: string[],
  state: ReasoningRoundTripState
): void {
  if (!reasoning || toolCallIds.length === 0) return
  // 按时间顺序追加到轮次列表
  state.toolRounds.push({ toolCallIds, reasoning })
  // 按 tool_call_id 建立快速索引
  for (const id of toolCallIds) {
    state.byToolCallId.set(id, reasoning)
  }
}
