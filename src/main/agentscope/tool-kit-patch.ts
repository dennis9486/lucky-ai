import type { Toolkit } from '@agentscope-ai/agentscope/tool'
import {
  clearActiveToolCall,
  getActiveTurnId,
  setActiveToolCall
} from './tool-turn-context.js'

/** 在 callToolFunction 入口登记 tool_call_id，供 wrapTool 幂等层读取。 */
export function patchToolkitToolContext(toolkit: Toolkit, conversationKey?: string): void {
  if (!conversationKey) return

  const original = toolkit.callToolFunction.bind(toolkit)
  toolkit.callToolFunction = async function* (toolCall) {
    const turnId = getActiveTurnId(conversationKey)
    if (turnId) {
      setActiveToolCall(conversationKey, {
        turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name
      })
    }
    try {
      const stream = original(toolCall)
      let next = await stream.next()
      while (!next.done) {
        yield next.value
        next = await stream.next()
      }
      return next.value
    } finally {
      clearActiveToolCall(conversationKey)
    }
  }
}
