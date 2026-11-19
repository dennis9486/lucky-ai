import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentRunnerEvent, AgentRunnerOptions } from '../services/agentscope-client.js'

// chat.store 是纯编排：真正的 agent 主循环在 agentscope-client，会话/项目/设置/UI 都是别的 store。
// 用 hoisted 替身把这些接缝 mock 掉，只验证 store 自身对事件流的装配、落盘、用量累计与兜底逻辑。
const h = vi.hoisted(() => {
  const runAgentScope = vi.fn(async (_text: string, _opts: AgentRunnerOptions) => {})
  const summarizeAgentTitle = vi.fn(async () => 'Nice title')
  const confirmAgentTools = vi.fn()
  const session = {
    activeSessionId: 's1' as string | null,
    activeSession: { id: 's1', messages: [] as unknown[] },
    summaries: [{ id: 's1', title: 'Test session', updatedAt: Date.now() }],
    ensureActiveSession: vi.fn(async () => ({ id: 's1' })),
    loadSessionMessages: vi.fn(async () => []),
    touchSession: vi.fn(async () => {}),
    updateSessionMessages: vi.fn(async () => {}),
    appendMessageToSession: vi.fn(async () => {}),
    upsertMessageToSession: vi.fn(async (_sessionId: string, _msg: unknown) => {}),
    canApplyAutoTitle: vi.fn(() => true),
    applyAutoTitle: vi.fn(async () => {})
  }
  const project = { approvalMode: 'auto', activeProject: { rootPath: '/ws', name: 'ws' } }
  const settings = { maxAgentSteps: 20 }
  const ui = {
    composerAttachments: [] as Array<{ path: string; name: string; kind: string; previewUrl?: string }>,
    planMode: false,
    clearComposerAttachments: vi.fn()
  }
  const memoryCapture = vi.fn(async () => ({ success: true, data: undefined }))
  return { runAgentScope, summarizeAgentTitle, confirmAgentTools, session, project, settings, ui, memoryCapture }
})

vi.mock('../services/agentscope-client.js', () => ({
  runAgentScope: h.runAgentScope,
  confirmAgentTools: h.confirmAgentTools,
  summarizeAgentTitle: h.summarizeAgentTitle
}))
vi.mock('../services/ipc-client.js', () => ({
  ipc: { memory: { capture: h.memoryCapture } },
  unwrap: async (p: Promise<unknown>) => p
}))
vi.mock('../i18n/index.js', () => ({
  tGlobal: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  i18n: { global: { locale: { value: 'zh-CN' } } }
}))
vi.mock('./session.store.js', () => ({ useSessionStore: () => h.session }))
vi.mock('./project.store.js', () => ({ useProjectStore: () => h.project }))
vi.mock('./settings.store.js', () => ({ useSettingsStore: () => h.settings }))
vi.mock('./ui.store.js', () => ({ useUiStore: () => h.ui }))

import { useChatStore } from './chat.store.js'

function drive(events: AgentRunnerEvent[]): void {
  h.runAgentScope.mockImplementation(async (_text, opts) => {
    for (const event of events) opts.onEvent(event)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.session.activeSessionId = 's1'
  h.session.activeSession = { id: 's1', messages: [] }
  h.session.ensureActiveSession.mockResolvedValue({ id: 's1' })
  h.session.canApplyAutoTitle.mockReturnValue(true)
  h.summarizeAgentTitle.mockResolvedValue('Nice title')
  h.project.approvalMode = 'auto'
  h.ui.composerAttachments = []
  h.ui.planMode = false
  // 无 DOM：把 rAF 变成即时同步执行，让流式装配路径真正被覆盖
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

describe('chat store — computed views', () => {
  it('displayMessages hides the live streaming assistant draft', () => {
    const store = useChatStore()
    h.session.activeSession = {
      id: 's1',
      messages: [
        { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
        { id: 'a1', role: 'assistant', content: 'draft', timestamp: 0 }
      ]
    }
    store.streamingParts = [{ type: 'text', text: 'live' }]
    store.streamingMessageId = 'a1'
    expect(store.displayMessages.map((m) => m.id)).toEqual(['u1'])
  })

  it('showPendingConfirm only surfaces when the confirm belongs to the active session', () => {
    const store = useChatStore()
    store.pendingConfirm = { agentSessionId: 'x', chatSessionId: 's2', replyId: 'r', toolCalls: [] }
    expect(store.showPendingConfirm).toBe(false)
    store.pendingConfirm = { agentSessionId: 'x', chatSessionId: 's1', replyId: 'r', toolCalls: [] }
    expect(store.showPendingConfirm).toBe(true)
  })
})

describe('chat store — sendMessage guards', () => {
  it('no-ops when input is empty and there are no attachments', async () => {
    const store = useChatStore()
    store.input = '   '
    await store.sendMessage()
    expect(h.runAgentScope).not.toHaveBeenCalled()
  })

  it('queues a follow-up when the active session is already running', async () => {
    const store = useChatStore()
    h.runAgentScope.mockImplementation(() => new Promise(() => {}))

    store.input = 'first'
    void store.sendMessage()
    await vi.waitFor(() => expect(store.isRunning).toBe(true))

    store.input = 'queued'
    await store.sendMessage()

    expect(h.runAgentScope).toHaveBeenCalledTimes(1)
    expect(store.queuedMessages).toHaveLength(1)
    expect(store.queuedMessages[0]?.userText).toBe('queued')
    expect(store.input).toBe('')
  })
})

describe('chat store — sendMessage happy path', () => {
  it('accumulates usage, persists a final assistant message, and refreshes the title', async () => {
    const store = useChatStore()
    drive([
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world' },
      { type: 'tokens', input: 1000, output: 5 },
      { type: 'tokens', input: 1200, output: 3 },
      { type: 'done' }
    ] as AgentRunnerEvent[])

    store.input = 'do it'
    await store.sendMessage()

    expect(store.input).toBe('')
    expect(store.isRunning).toBe(false)
    expect(h.ui.clearComposerAttachments).toHaveBeenCalledOnce()

    // 用量：input 取「最近一次」上下文大小（不求和），output 累计
    expect(store.loopState.usage).toEqual({ inputTokens: 1200, outputTokens: 8 })

    // 最终落盘的 assistant 消息：streaming 结束、带 runSummary、内容为拼接文本
    const finalCall = h.session.upsertMessageToSession.mock.calls.at(-1)
    expect(finalCall?.[0]).toBe('s1')
    const finalMsg = finalCall?.[1] as { role: string; content: string; meta: Record<string, unknown> }
    expect(finalMsg.role).toBe('assistant')
    expect(finalMsg.content).toContain('Hello world')
    expect(finalMsg.meta.streaming).toBe(false)
    expect(finalMsg.meta.incomplete).toBeUndefined()

    // done 且有内容 → 触发记忆捕获 + 标题总结
    expect(h.memoryCapture).toHaveBeenCalledOnce()
    expect(h.summarizeAgentTitle).toHaveBeenCalledOnce()
    expect(h.session.applyAutoTitle).toHaveBeenCalledWith('s1', 'Nice title')
  })

  it('passes a pre-generated requestId to runAgentScope for turn-scoped idempotency', async () => {
    const store = useChatStore()
    drive([{ type: 'done' }] as AgentRunnerEvent[])

    store.input = 'hello'
    await store.sendMessage()

    const opts = h.runAgentScope.mock.calls[0]?.[1] as AgentRunnerOptions | undefined
    expect(opts?.requestId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('falls back to a visible notice when the model returns no content', async () => {
    const store = useChatStore()
    drive([{ type: 'done' }] as AgentRunnerEvent[])

    store.input = 'do it'
    await store.sendMessage()

    const finalMsg = h.session.upsertMessageToSession.mock.calls.at(-1)?.[1] as {
      content: string
      meta: Record<string, unknown>
    }
    expect(finalMsg.content).toContain('chat.emptyModelResponse')
    // 空回复归为 error（而非 incomplete/interrupted），且不写入记忆、不总结标题
    expect(store.loopState.status).toBe('error')
    expect(h.memoryCapture).not.toHaveBeenCalled()
    expect(h.summarizeAgentTitle).not.toHaveBeenCalled()
  })

  it('surfaces a runner error inline and marks the run incomplete', async () => {
    const store = useChatStore()
    h.runAgentScope.mockRejectedValueOnce(new Error('boom'))

    store.input = 'do it'
    await store.sendMessage()

    const finalMsg = h.session.upsertMessageToSession.mock.calls.at(-1)?.[1] as {
      content: string
      meta: Record<string, unknown>
    }
    expect(finalMsg.content).toContain('boom')
    expect(finalMsg.meta.incomplete).toBe(true)
    expect(store.loopState.status).toBe('error')
  })

  it('marks max-step exits as incomplete without treating them as runner errors', async () => {
    const store = useChatStore()
    drive([
      { type: 'text', content: 'I checked part of it.' },
      { type: 'max_steps', message: 'chat.maxStepsReached' }
    ] as AgentRunnerEvent[])

    store.input = 'do it'
    await store.sendMessage()

    const finalMsg = h.session.upsertMessageToSession.mock.calls.at(-1)?.[1] as {
      content: string
      meta: Record<string, unknown>
    }
    expect(finalMsg.content).toContain('I checked part of it.')
    expect(finalMsg.content).toContain('chat.maxStepsReached')
    expect(finalMsg.meta.incomplete).toBe(true)
    expect(store.loopState.status).toBe('incomplete')
    expect(h.memoryCapture).not.toHaveBeenCalled()
    expect(h.summarizeAgentTitle).not.toHaveBeenCalled()
  })

  it('prompts continuation when tools ran but no final answer was produced', async () => {
    const store = useChatStore()
    drive([
      { type: 'tool_call', id: 'tool-1', name: 'Read' },
      { type: 'tool_args', id: 'tool-1', input: { path: '/tmp/a.ts' } },
      { type: 'tool_output', id: 'tool-1', delta: 'file content' },
      { type: 'tool_end', id: 'tool-1', status: 'success' },
      { type: 'done' }
    ] as AgentRunnerEvent[])

    store.input = 'inspect it'
    await store.sendMessage()

    const finalMsg = h.session.upsertMessageToSession.mock.calls.at(-1)?.[1] as {
      content: string
      meta: Record<string, unknown>
    }
    expect(finalMsg.content).toContain('chat.missingFinalAnswer')
    expect(finalMsg.meta.incomplete).toBe(true)
    expect(store.loopState.status).toBe('incomplete')
  })
})

describe('chat store — stop', () => {
  it('abortIfRunning stops an in-flight run and marks status stopped', async () => {
    const store = useChatStore()
    let abortSignal: AbortSignal | undefined
    h.runAgentScope.mockImplementation(async (_text, opts) => {
      abortSignal = opts.signal
      await new Promise(() => {})
    })

    store.input = 'hello'
    void store.sendMessage()
    await vi.waitFor(() => expect(store.isRunning).toBe(true))

    store.abortIfRunning()
    expect(abortSignal?.aborted).toBe(true)
    expect(store.loopState.status).toBe('stopped')
  })

  it('abortIfRunning is a no-op when idle', () => {
    const store = useChatStore()
    store.abortIfRunning()
    expect(store.loopState.status).not.toBe('stopped')
  })
})
