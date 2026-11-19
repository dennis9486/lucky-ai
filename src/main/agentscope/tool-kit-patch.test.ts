import type { Tool, Toolkit } from '@agentscope-ai/agentscope/tool'
import { afterEach, describe, expect, it } from 'vitest'
import { patchToolkitToolContext } from './tool-kit-patch.js'
import { clearActiveToolCall, clearActiveTurnId, setActiveTurnId } from './tool-turn-context.js'

const CONVERSATION_KEY = 'conv-patch'

function createToolkitWithTool(tool: Tool): Toolkit {
  const tools = new Map<string, Tool>([[tool.name, tool]])
  return {
    callToolFunction: async function* (toolCall: { id: string; name: string; input?: Record<string, unknown> }) {
      const registered = tools.get(toolCall.name)
      if (!registered?.call) throw new Error(`missing tool ${toolCall.name}`)
      const result = await registered.call((toolCall.input ?? {}) as never)
      yield result
      return result
    }
  } as unknown as Toolkit
}

describe('patchToolkitToolContext', () => {
  afterEach(() => {
    clearActiveTurnId(CONVERSATION_KEY, 'turn-1')
    clearActiveToolCall(CONVERSATION_KEY)
  })

  it('registers active tool call for the duration of callToolFunction', async () => {
    let observedToolCallId = ''
    const tool: Tool = {
      name: 'Calc',
      description: 'mock calc',
      requireUserConfirm: false,
      call: async () => '42'
    } as unknown as Tool

    const wrappedTool: Tool = {
      ...tool,
      call: async () => {
        const { getActiveToolCall } = await import('./tool-turn-context.js')
        observedToolCallId = getActiveToolCall(CONVERSATION_KEY)?.toolCallId ?? ''
        return '42'
      }
    } as unknown as Tool

    const toolkit = createToolkitWithTool(wrappedTool)
    patchToolkitToolContext(toolkit, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, 'turn-1')

    const stream = toolkit.callToolFunction({ id: 'calc-1', name: 'Calc' } as never)
    for await (const _ of stream) {
      // drain
    }

    expect(observedToolCallId).toBe('calc-1')
    const { getActiveToolCall } = await import('./tool-turn-context.js')
    expect(getActiveToolCall(CONVERSATION_KEY)).toBeUndefined()
  })

  it('forwards generator return values from the original callToolFunction', async () => {
    const tool: Tool = {
      name: 'Time',
      description: 'mock time',
      requireUserConfirm: false,
      call: async () => ({ content: [{ type: 'text', text: 'now' }] })
    } as unknown as Tool

    const toolkit = createToolkitWithTool(tool)
    patchToolkitToolContext(toolkit, CONVERSATION_KEY)
    setActiveTurnId(CONVERSATION_KEY, 'turn-1')

    const stream = toolkit.callToolFunction({ id: 'time-1', name: 'Time' } as never)
    const chunks: unknown[] = []
    let returnValue: unknown
    while (true) {
      const next = await stream.next()
      if (next.done) {
        returnValue = next.value
        break
      }
      chunks.push(next.value)
    }

    expect(chunks).toHaveLength(1)
    expect(returnValue).toEqual({ content: [{ type: 'text', text: 'now' }] })
  })

  it('is a no-op when conversationKey is missing', async () => {
    let callCount = 0
    const tool: Tool = {
      name: 'Calc',
      description: 'mock calc',
      requireUserConfirm: false,
      call: async () => {
        callCount += 1
        return '1'
      }
    } as unknown as Tool

    const toolkit = createToolkitWithTool(tool)
    patchToolkitToolContext(toolkit)

    const stream = toolkit.callToolFunction({ id: 'calc-1', name: 'Calc' } as never)
    for await (const _ of stream) {
      // drain
    }

    expect(callCount).toBe(1)
  })
})
