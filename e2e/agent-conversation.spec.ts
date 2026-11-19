/**
 * Agent 对话往返 E2E — 覆盖对话主链路：
 * settings 配置 Provider → workspace 打开 → agent.send（渲染进程预订阅事件）
 * → agent-manager 构建 ReActAgent → OpenAI 兼容模型流式调用 →
 * event-bridge 事件映射 → 渲染进程收到 text_delta / reply_end。
 *
 * 模型端点是测试进程内起的 OpenAI 兼容 mock（SSE 流式回复固定文本），
 * 不依赖网络与真实模型；断言的是「事件流完整走通」而非模型质量。
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const REPLY_TEXT = 'PONG_E2E_REPLY'

let app: ElectronApplication
let window: Page
let server: Server
let baseUrl: string

/**
 * 每轮模型调用的脚本化回复：text = 固定文本；tool_call = 一次需要用户
 * 确认的 Write 工具调用（用于中止/恢复场景）。队列空时回落到 text。
 */
type MockReply = 'text' | 'tool_call'
const replyQueue: MockReply[] = []

/** OpenAI 兼容 mock：按 replyQueue 脚本回 SSE 流 */
function startMockOpenAiServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (!req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      // 消费请求体后再回流（openai SDK 等待写完）
      req.resume()
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        const chunk = (delta: Record<string, unknown>, finish: string | null) =>
          `data: ${JSON.stringify({
            id: 'e2e-1',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'e2e-mock',
            choices: [{ index: 0, delta, finish_reason: finish }]
          })}\n\n`

        const mode = replyQueue.shift() ?? 'text'
        if (mode === 'tool_call') {
          res.write(chunk({
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_e2e_write',
              type: 'function',
              function: { name: 'Write', arguments: '' }
            }]
          }, null))
          res.write(chunk({
            tool_calls: [{ index: 0, function: { arguments: '{"file_path":"e2e-abort.txt","content":"x"}' } }]
          }, null))
          res.write(chunk({}, 'tool_calls'))
        } else {
          res.write(chunk({ role: 'assistant', content: REPLY_TEXT }, null))
          res.write(chunk({}, 'stop'))
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    srv.listen(0, '127.0.0.1', () => {
      resolve({ server: srv, port: (srv.address() as { port: number }).port })
    })
  })
}

test.beforeAll(async () => {
  const mock = await startMockOpenAiServer()
  server = mock.server
  baseUrl = `http://127.0.0.1:${mock.port}/v1`

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LUCKY_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'lucky-e2e-agent-'))
    }
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  server?.close()
})

test('agent send roundtrip streams a model reply back to the renderer', async () => {
  test.setTimeout(120_000)
  const workspaceDir = mkdtempSync(join(tmpdir(), 'lucky-e2e-agent-ws-'))

  const result = await window.evaluate(async ({ modelBaseUrl, workspacePath }) => {
    const api = (window as unknown as {
      luckyAI: {
        settings: {
          set: (partial: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
        }
        workspace: {
          set: (rootPath: string) => Promise<{ success: boolean; error?: string }>
        }
        agent: {
          send: (
            request: Record<string, unknown>,
            onEvent: (event: { type: string; delta?: string; message?: string }) => void
          ) => Promise<{ success: boolean; data?: string; error?: string }>
        }
      }
    }).luckyAI

    const provider = {
      id: 'e2e-provider',
      type: 'openai',
      vendor: 'custom',
      name: 'E2E Mock',
      baseUrl: modelBaseUrl,
      apiKey: 'e2e-key',
      model: 'e2e-mock',
      models: [{ id: 'e2e-model-0', name: 'e2e-mock', enabled: true, vision: 'off' }],
      activeModelId: 'e2e-model-0',
      enabled: true
    }
    const configured = await api.settings.set({ providers: [provider], activeProviderId: 'e2e-provider' })
    if (!configured.success) return { phase: 'settings', error: configured.error }

    const ws = await api.workspace.set(workspacePath)
    if (!ws.success) return { phase: 'workspace', error: ws.error }

    const events: Array<{ type: string; delta?: string; message?: string }> = []
    let settle!: () => void
    const done = new Promise<void>((resolve) => { settle = resolve })
    const timeout = setTimeout(settle, 90_000)

    const sent = await api.agent.send(
      { conversationId: 'e2e-conversation', message: 'ping', approvalMode: 'ask', agentMode: 'chat' },
      (event) => {
        events.push({ type: event.type, delta: event.delta, message: event.message })
        if (event.type === 'reply_end' || event.type === 'error') {
          clearTimeout(timeout)
          settle()
        }
      }
    )
    if (!sent.success) return { phase: 'send', error: sent.error }

    await done
    return {
      phase: 'done',
      eventTypes: events.map((event) => event.type),
      text: events.filter((event) => event.type === 'text_delta').map((event) => event.delta ?? '').join(''),
      error: events.find((event) => event.type === 'error')?.message
    }
  }, { modelBaseUrl: baseUrl, workspacePath: workspaceDir })

  expect(result.phase).toBe('done')
  expect(result.error).toBeUndefined()
  expect(result.eventTypes).toContain('reply_start')
  expect(result.eventTypes).toContain('reply_end')
  expect(result.text).toContain(REPLY_TEXT)
})

test('conversation survives an aborted turn at the confirm gate', async () => {
  test.setTimeout(120_000)
  // 复现事故链：模型请求需确认的 Write → 用户在确认关卡中止 →
  // 上下文残留悬空 tool_call。修复前，下一次发消息会抛
  // "Agent is awaiting 'USER_CONFIRM_RESULT'"，会话在本次运行内卡死。
  replyQueue.push('tool_call', 'text')

  const result = await window.evaluate(async () => {
    const api = (window as unknown as {
      luckyAI: {
        agent: {
          send: (
            request: Record<string, unknown>,
            onEvent: (event: { type: string; delta?: string; message?: string; error?: string }) => void
          ) => Promise<{ success: boolean; data?: string; error?: string }>
          abort: (sessionId: string) => Promise<{ success: boolean }>
        }
      }
    }).luckyAI

    // ── 第一轮：走到确认关卡就中止 ────────────────────────────
    let firstSettle!: () => void
    const firstDone = new Promise<void>((resolve) => { firstSettle = resolve })
    const firstTimeout = setTimeout(firstSettle, 45_000)
    let confirmSeen = false
    let firstSessionId = ''

    const first = await api.agent.send(
      { conversationId: 'e2e-abort-conv', message: 'write something', approvalMode: 'ask', agentMode: 'chat' },
      (event) => {
        if (event.type === 'require_confirm' && !confirmSeen) {
          confirmSeen = true
          void api.agent.abort(firstSessionId)
        }
        if (event.type === 'reply_end' || event.type === 'error') {
          clearTimeout(firstTimeout)
          firstSettle()
        }
      }
    )
    if (!first.success || !first.data) return { phase: 'first-send', error: first.error }
    firstSessionId = first.data
    await firstDone
    if (!confirmSeen) return { phase: 'first-turn', error: 'confirm gate never reached' }

    // ── 第二轮：同一会话再次发消息，必须正常往返 ──────────────
    const events: Array<{ type: string; delta?: string; error?: string }> = []
    let secondSettle!: () => void
    const secondDone = new Promise<void>((resolve) => { secondSettle = resolve })
    const secondTimeout = setTimeout(secondSettle, 45_000)

    const second = await api.agent.send(
      { conversationId: 'e2e-abort-conv', message: 'are you still there?', approvalMode: 'ask', agentMode: 'chat' },
      (event) => {
        events.push({ type: event.type, delta: event.delta, error: event.error })
        if (event.type === 'reply_end' || event.type === 'error') {
          clearTimeout(secondTimeout)
          secondSettle()
        }
      }
    )
    if (!second.success) return { phase: 'second-send', error: second.error }
    await secondDone

    return {
      phase: 'done',
      error: events.find((event) => event.type === 'error')?.error,
      eventTypes: events.map((event) => event.type),
      text: events.filter((event) => event.type === 'text_delta').map((event) => event.delta ?? '').join('')
    }
  })

  expect(result.phase).toBe('done')
  expect(result.error).toBeUndefined()
  expect(result.eventTypes).toContain('reply_end')
  expect(result.text).toContain(REPLY_TEXT)
})
