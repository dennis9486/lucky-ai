/** 当前会话活跃 Agent 轮次（requestId / sessionId），供工具幂等与观测关联。 */
const activeTurnByConversation = new Map<string, string>()

export function setActiveTurnId(conversationKey: string, turnId: string): void {
  activeTurnByConversation.set(conversationKey, turnId)
}

export function clearActiveTurnId(conversationKey: string, turnId: string): void {
  if (activeTurnByConversation.get(conversationKey) === turnId) {
    activeTurnByConversation.delete(conversationKey)
  }
}

export function getActiveTurnId(conversationKey: string): string | undefined {
  return activeTurnByConversation.get(conversationKey)
}

interface ActiveToolCall {
  turnId: string
  toolCallId: string
  toolName: string
}

const activeToolByConversation = new Map<string, ActiveToolCall>()

export function setActiveToolCall(conversationKey: string, call: ActiveToolCall): void {
  activeToolByConversation.set(conversationKey, call)
}

export function clearActiveToolCall(conversationKey: string): void {
  activeToolByConversation.delete(conversationKey)
}

export function getActiveToolCall(conversationKey: string): ActiveToolCall | undefined {
  return activeToolByConversation.get(conversationKey)
}
