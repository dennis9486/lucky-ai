import type { Tool } from '@agentscope-ai/agentscope/tool'
import type { Toolkit } from '@agentscope-ai/agentscope/tool'
import { afterEach, describe, expect, it } from 'vitest'
import { patchToolkitToolContext } from './tool-kit-patch.js'
import {
  clearTurnToolExecutions,
  getSuccessfulToolReplay
} from './tool-idempotency.js'
import {
  clearActiveToolCall,
  clearActiveTurnId,
  setActiveToolCall,
  setActiveTurnId
} from './tool-turn-context.js'
import { wrapTool } from './tools/tool-helpers.js'

const CONVERSATION_KEY = 'conv-test'
const TURN_ID = 'run-request-id-1'

function createMockWriteTool(onExecute: () => void): Tool {
  return {
    name: 'Write',
    description: 'mock write',
    requireUserConfirm: false,
    call: async () => {
      onExecute()
      return 'written'
    }
  } as unknown as Tool
}

function createMockReadTool(onExecute: () => void): Tool {
  return {
    name: 'Read',
    description: 'mock read',
    requireUserConfirm: false,
    call: async () => {
      onExecute()
      return 'file contents'
    }
  } as unknown as Tool
}

function withActiveToolCall(toolCallId: string, toolName: string, run: () => Promise<unknown>): Promise<unknown> {
  setActiveToolCall(CONVERSATION_KEY, { turnId: TURN_ID, toolCallId, toolName })
  return run().finally(() => clearActiveToolCall(CONVERSATION_KEY))
}

function createPatchedToolkit(tool: Tool, conversationKey = CONVERSATION_KEY): Toolkit {
  const tools = new Map<string, Tool>([[tool.name, tool]])
  const base = {
    callToolFunction: async function* (toolCall: { id: string; name: string; input?: Record<string, unknown> }) {
      const registered = tools.get(toolCall.name)
      if (!registered?.call) throw new Error(`missing tool ${toolCall.name}`)
      const result = await registered.call((toolCall.input ?? {}) as never)
      yield result
      return result
    }
  } as unknown as Toolkit

  patchToolkitToolContext(base, conversationKey)
  return base
}

async function invokeToolCall(
  toolkit: Toolkit,
  toolCall: { id: string; name: string; input?: Record<string, unknown> }
): Promise<unknown> {
  const stream = toolkit.callToolFunction(toolCall as never)
  let last: unknown
  for await (const chunk of stream) last = chunk
  return last
}

describe('tool idempotency integration', () => {
  afterEach(() => {
    clearTurnToolExecutions(TURN_ID)
    clearTurnToolExecutions('run-request-id-2')
    clearActiveTurnId(CONVERSATION_KEY, TURN_ID)
    clearActiveToolCall(CONVERSATION_KEY)
  })

  it('wrapTool replays a successful side-effect tool for the same turn + toolCallId', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, TURN_ID)

    await withActiveToolCall('tool-call-1', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })
    const replay = await withActiveToolCall('tool-call-1', 'Write', async () => {
      return wrapped.call!({ file_path: '/tmp/a.ts' })
    })

    expect(executions).toBe(1)
    expect(String(replay)).toContain('[Idempotent replay:')
    expect(getSuccessfulToolReplay(TURN_ID, 'tool-call-1')).toBe('written')
  })

  it('executes again when toolCallId differs within the same turn', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, TURN_ID)

    await withActiveToolCall('tool-call-a', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })
    await withActiveToolCall('tool-call-b', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/b.ts' })
    })

    expect(executions).toBe(2)
  })

  it('does not replay non side-effect tools such as Read', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockReadTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, TURN_ID)

    await withActiveToolCall('tool-call-read', 'Read', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })

    expect(executions).toBe(2)
    expect(getSuccessfulToolReplay(TURN_ID, 'tool-call-read')).toBeUndefined()
  })

  it('skips idempotency when conversationKey is omitted', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined)

    setActiveTurnId(CONVERSATION_KEY, TURN_ID)
    await withActiveToolCall('tool-call-1', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })

    expect(executions).toBe(2)
  })

  it('allows the same toolCallId again after the turn cache is cleared', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, TURN_ID)

    await withActiveToolCall('tool-call-1', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })
    clearTurnToolExecutions(TURN_ID)

    await withActiveToolCall('tool-call-1', 'Write', async () => {
      await wrapped.call!({ file_path: '/tmp/a.ts' })
    })

    expect(executions).toBe(2)
  })

  it('routes duplicate tool_call_id through patched toolkit.callToolFunction only once', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    const toolkit = createPatchedToolkit(wrapped)
    setActiveTurnId(CONVERSATION_KEY, TURN_ID)

    const toolCall = { id: 'tool-call-1', name: 'Write', input: { file_path: '/tmp/a.ts' } }
    const first = await invokeToolCall(toolkit, toolCall)
    const second = await invokeToolCall(toolkit, toolCall)

    expect(executions).toBe(1)
    expect(first).toBe('written')
    expect(String(second)).toContain('[Idempotent replay:')
  })

  it('mirrors agent-manager turn lifecycle: requestId turn scopes replay until cleared', async () => {
    let executions = 0
    const wrapped = wrapTool(createMockWriteTool(() => { executions += 1 }), () => {}, false, undefined, false, undefined, CONVERSATION_KEY)
    const toolkit = createPatchedToolkit(wrapped)

    // agent-manager.sendMessage(sessionId=requestId) + setActiveTurnId(conversationKey, sessionId)
    const requestId = TURN_ID
    setActiveTurnId(CONVERSATION_KEY, requestId)

    const toolCall = { id: 'tool-call-1', name: 'Write', input: { file_path: '/tmp/a.ts' } }
    await invokeToolCall(toolkit, toolCall)
    await invokeToolCall(toolkit, toolCall)
    expect(executions).toBe(1)

    // agent-manager finally: clearTurnToolExecutions(sessionId)
    clearTurnToolExecutions(requestId)
    clearActiveTurnId(CONVERSATION_KEY, requestId)

    const nextRequestId = 'run-request-id-2'
    setActiveTurnId(CONVERSATION_KEY, nextRequestId)
    await invokeToolCall(toolkit, toolCall)
    expect(executions).toBe(2)
  })
})
