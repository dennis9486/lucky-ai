import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Msg } from '@agentscope-ai/agentscope/message'
import { AnthropicChatModel } from './anthropic-model.js'

function msg(role: 'system' | 'user' | 'assistant', blocks: Array<Record<string, unknown>>): Msg {
  return { id: crypto.randomUUID(), name: role, role, content: blocks } as unknown as Msg
}

function textBlock(text: string): Record<string, unknown> {
  return { type: 'text', text, id: crypto.randomUUID() }
}

/** 构造 SSE 响应体 */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const payload = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AnthropicChatModel', () => {
  it('maps msgs to Anthropic format with system/tools/cache_control and streams deltas', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse([
      { type: 'message_start', message: { usage: { input_tokens: 90, cache_read_input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.ts"}' } },
      { type: 'message_delta', usage: { output_tokens: 12 } },
      { type: 'message_stop' }
    ]))

    const model = new AnthropicChatModel({ modelName: 'claude-sonnet-4-5', apiKey: 'sk-test' })
    const result = await model.call({
      messages: [
        msg('system', [textBlock('You are Lucky.')]),
        msg('user', [textBlock('读一下 a.ts')])
      ],
      tools: [{
        type: 'function',
        function: { name: 'Read', description: 'Read file', parameters: { type: 'object', properties: {} } }
      }] as never,
      toolChoice: 'auto'
    })

    // ── 请求体断言 ──────────────────────────────────────────
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBeTruthy()

    const body = JSON.parse(String((init as RequestInit).body)) as {
      system: Array<Record<string, unknown>>
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
      tools: Array<Record<string, unknown>>
      tool_choice: Record<string, unknown>
    }
    expect(body.system[0]?.text).toBe('You are Lucky.')
    expect(body.system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.tools[0]).toMatchObject({ name: 'Read', input_schema: { type: 'object' } })
    expect(body.tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.tool_choice).toEqual({ type: 'auto' })
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[0]?.content.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })

    // ── 流式语义断言：增量 chunk + return 完整响应 ──────────
    const generator = result as AsyncGenerator<{ content: Array<Record<string, unknown>>; usage?: { inputTokens: number; outputTokens: number } }>
    const chunks: Array<{ content: Array<Record<string, unknown>> }> = []
    let final: { content: Array<Record<string, unknown>>; usage?: { inputTokens: number; outputTokens: number } } | undefined
    while (true) {
      const step = await generator.next()
      if (step.done) {
        final = step.value as typeof final
        break
      }
      chunks.push(step.value)
    }

    const textDeltas = chunks.flatMap((c) => c.content).filter((b) => b.type === 'text').map((b) => b.text)
    expect(textDeltas).toEqual(['你', '好'])

    expect(final?.content.find((b) => b.type === 'text')?.text).toBe('你好')
    const toolCall = final?.content.find((b) => b.type === 'tool_call')
    expect(toolCall).toMatchObject({ id: 'tu_1', name: 'Read', input: '{"file_path":"a.ts"}' })
    // usage：常规输入 + 缓存读取合并计入 inputTokens
    expect(final?.usage?.inputTokens).toBe(100)
    expect(final?.usage?.outputTokens).toBe(12)
  })

  it('converts tool_call/tool_result history into tool_use/tool_result blocks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse([
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'message_stop' }
    ]))

    const model = new AnthropicChatModel({ modelName: 'claude-sonnet-4-5', apiKey: 'k' })
    const generator = await model.call({
      messages: [
        msg('user', [textBlock('改文件')]),
        msg('assistant', [
          textBlock('好的'),
          { type: 'tool_call', id: 'tu_9', name: 'Edit', input: '{"file_path":"b.ts"}', state: 'pending' }
        ]),
        msg('user', [{ type: 'tool_result', id: 'tu_9', name: 'Edit', output: [textBlock('ok')] }])
      ]
    }) as AsyncGenerator<unknown>
    // 消费流（内容为空，仅触发请求）
    while (!(await generator.next()).done) { /* drain */ }

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    const assistant = body.messages[1]!
    expect(assistant.content.find((b) => b.type === 'tool_use')).toMatchObject({
      id: 'tu_9',
      name: 'Edit',
      input: { file_path: 'b.ts' }
    })
    const toolResult = body.messages[2]!.content.find((b) => b.type === 'tool_result')
    expect(toolResult).toMatchObject({ tool_use_id: 'tu_9' })
  })

  it('throws a descriptive error on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })
    )
    const model = new AnthropicChatModel({ modelName: 'claude-sonnet-4-5', apiKey: 'bad', stream: false })
    // maxRetries 默认会重试，直接调用 _callAPI 断言错误形态
    await expect(
      model.call({ messages: [msg('user', [textBlock('hi')])] })
    ).rejects.toThrow(/Anthropic API 401/)
  })
})
