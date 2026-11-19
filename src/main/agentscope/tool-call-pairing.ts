/**
 * tool-call-pairing.ts — 修复 OpenAI 兼容消息序列里 tool_calls 与 tool 响应的配对。
 *
 * 背景：回复中断时，带 tool_calls 的 assistant 消息可能已落库、而对应的 tool 结果尚未落库。
 * 这段残缺历史再次发送会被 OpenAI 兼容 API 以 400 拒绝：
 *   "An assistant message with 'tool_calls' must be followed by tool messages
 *    responding to each 'tool_call_id'."
 *
 * 发送前在此保证不变量：每个 assistant.tool_calls[].id 都有且仅有一条紧随其后的
 * role:'tool' 响应——缺失的补占位结果，游离/重复/不匹配的 tool 消息丢弃。
 */

/** 中断遗留的工具调用占位结果，让模型知道该调用未产出结果。 */
const INTERRUPTED_TOOL_RESULT = '[上一轮工具调用被中断，未产生结果]'

interface OpenAiMessage {
  role?: unknown
  tool_calls?: unknown
  tool_call_id?: unknown
}

/** 取出 assistant 消息声明的全部 tool_call id（非 assistant 或无 tool_calls 返回空数组）。 */
function toolCallIds(message: OpenAiMessage): string[] {
  if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) return []
  return message.tool_calls
    .map((call) => (call as { id?: unknown }).id)
    .filter((id): id is string | number => id != null)
    .map(String)
}

/**
 * 修复一串 OpenAI 兼容消息，使 tool_calls 与 tool 响应严格配对。
 * 输入不被修改；返回新数组。
 */
export function repairToolCallPairing(
  messages: Record<string, unknown>[]
): Record<string, unknown>[] {
  const repaired: Record<string, unknown>[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    const requiredIds = toolCallIds(message as OpenAiMessage)

    if (requiredIds.length === 0) {
      // 游离 tool 消息（前面没有对应的 tool_calls）同样会触发 400，丢弃；其余原样保留。
      if ((message as OpenAiMessage).role !== 'tool') repaired.push(message)
      continue
    }

    repaired.push(message)

    // 紧随其后的一段 tool 消息即本轮工具结果：保留匹配项，丢弃不匹配/重复项。
    const answered = new Set<string>()
    let j = i + 1
    for (; j < messages.length && (messages[j] as OpenAiMessage).role === 'tool'; j++) {
      const id = (messages[j] as OpenAiMessage).tool_call_id
      const key = id == null ? '' : String(id)
      if (requiredIds.includes(key) && !answered.has(key)) {
        answered.add(key)
        repaired.push(messages[j])
      }
    }

    // 缺失的工具结果补占位，保证每个 id 都被应答。
    for (const id of requiredIds) {
      if (!answered.has(id)) {
        repaired.push({ role: 'tool', tool_call_id: id, content: INTERRUPTED_TOOL_RESULT })
      }
    }

    i = j - 1
  }

  return repaired
}
