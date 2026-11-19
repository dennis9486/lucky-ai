/** 单轮内已成功执行的 tool_call_id → 缓存结果（防止网络重试/模型重复调用造成二次副作用）。 */

const REPLAY_NOTE = '\n\n[Idempotent replay: this tool_call_id already succeeded in the current run.]'

const successfulResults = new Map<string, unknown>()

export const SIDE_EFFECT_TOOL_NAMES = new Set([
  'Write',
  'Edit',
  'Bash',
  'GeneratePdf',
  'CreateScheduledTask',
  'CreateSkill',
  'RunParallelTasks',
  'FillBrowserInput',
  'ClickBrowserElement',
  'PressBrowserKey'
])

function cacheKey(turnId: string, toolCallId: string): string {
  return `${turnId}:${toolCallId}`
}

export function getSuccessfulToolReplay(turnId: string, toolCallId: string): unknown | undefined {
  return successfulResults.get(cacheKey(turnId, toolCallId))
}

export function recordSuccessfulToolReplay(turnId: string, toolCallId: string, result: unknown): void {
  successfulResults.set(cacheKey(turnId, toolCallId), result)
}

export function clearTurnToolExecutions(turnId: string): void {
  const prefix = `${turnId}:`
  for (const key of [...successfulResults.keys()]) {
    if (key.startsWith(prefix)) successfulResults.delete(key)
  }
}

export function withReplayNotice(result: unknown): unknown {
  if (typeof result === 'string') {
    return result.includes('[Idempotent replay:') ? result : `${result}${REPLAY_NOTE}`
  }

  if (result && typeof result === 'object') {
    const response = result as { content?: Array<{ type?: string; text?: string }> }
    if (Array.isArray(response.content)) {
      const clone = {
        ...response,
        content: response.content.map((block) => {
          if (block?.type !== 'text' || typeof block.text !== 'string') return block
          if (block.text.includes('[Idempotent replay:')) return block
          return { ...block, text: `${block.text}${REPLAY_NOTE}` }
        })
      }
      return clone
    }
  }

  return result
}
