/**
 * anthropic-model.ts — Anthropic Messages API 原生 ChatModel（AgentScope 适配）
 *
 * AgentScope 内置模型没有 Anthropic 实现；OpenAI 兼容代理无法使用 prompt
 * caching / 原生工具流。本模块按 ChatModelBase 契约直连 Messages API：
 * - 流式：yield **增量** ChatResponse（与 DashScope/OpenAI 实现同语义），
 *   generator 的 return 值为累积完整响应（Agent 以此写入上下文）。
 * - Prompt caching：system 末块、tools 末项、最后一条消息末块打
 *   cache_control(ephemeral) —— 长会话下 system prompt（项目上下文+技能+
 *   记忆）与历史前缀命中缓存，显著降低首 token 延迟与费用。
 * - 消息映射在 _callAPI 内完成（不走 FormatterBase：本实现与映射强耦合，
 *   拆开只会增加间接层）。thinking 块不回传（未启用扩展思考，回传需签名）。
 *
 * 错误面：非 2xx 抛带响应体摘要的 Error（由 Agent 层统一呈现/重试）。
 */

import { ChatModelBase } from '@agentscope-ai/agentscope/model'
import type { ChatResponse, ChatUsage } from '@agentscope-ai/agentscope/model'
import type { Msg } from '@agentscope-ai/agentscope/message'
import { createLogger } from '../../shared/utils/log.js'

/** AgentScope 未公开导出 ToolSchema/ToolChoice，这里按结构等价定义 */
interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; [key: string]: unknown }
  }
}
/** 'auto' | 'none' | 'required' | 具体工具名（AgentScope 侧 ToolName = string） */
type ToolChoice = string
import { isDev } from '../app-env.js'

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_MAX_TOKENS = 8192

const logger = createLogger('main/anthropic-model', {
  debugEnabled: isDev
})

export interface AnthropicChatModelOptions {
  modelName: string
  apiKey: string
  baseUrl?: string
  maxTokens?: number
  supportsVision?: boolean
  stream?: boolean
  /** 当前轮的中止信号（按会话动态取）：中止时立即断掉在途请求 */
  getAbortSignal?: () => AbortSignal | undefined
}

/** Anthropic 消息内容块（请求侧最小面） */
type AnthropicBlock = Record<string, unknown>

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

/** AgentScope Msg 内容块的运行时形状（宽松读取） */
interface MsgBlockLike {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: string
  output?: unknown
  source?: { type?: string; media_type?: string; data?: string }
}

export class AnthropicChatModel extends ChatModelBase {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly maxTokens: number
  private readonly supportsVision: boolean
  private readonly getAbortSignal?: () => AbortSignal | undefined

  constructor(options: AnthropicChatModelOptions) {
    super({ modelName: options.modelName, stream: options.stream ?? true })
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
    this.supportsVision = options.supportsVision ?? true
    this.getAbortSignal = options.getAbortSignal
  }

  _formatToolSchemas(tools: ToolSchema[]): unknown[] {
    const formatted = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    })) as Array<Record<string, unknown>>
    // 缓存断点：工具列表在会话内稳定，末项打标即缓存全部 tools
    if (formatted.length) {
      formatted[formatted.length - 1] = {
        ...formatted[formatted.length - 1],
        cache_control: { type: 'ephemeral' }
      }
    }
    return formatted
  }

  _formatToolChoice(toolChoice: ToolChoice): unknown {
    if (toolChoice === 'auto') return { type: 'auto' }
    if (toolChoice === 'none') return { type: 'none' }
    if (toolChoice === 'required') return { type: 'any' }
    // 其余取值即具体工具名（AgentScope ToolName = string）
    if (toolChoice) return { type: 'tool', name: toolChoice }
    return { type: 'auto' }
  }

  protected async _callAPI(
    modelName: string,
    options: { messages: unknown[]; tools?: ToolSchema[]; toolChoice?: ToolChoice; [key: string]: unknown }
  ): Promise<ChatResponse | AsyncGenerator<ChatResponse>> {
    // 未配置 formatter，messages 即原始 AgentScope Msg[]
    const { system, messages } = this.formatMessages(options.messages as Msg[])
    const body: Record<string, unknown> = {
      model: modelName,
      max_tokens: this.maxTokens,
      system,
      messages,
      stream: this.stream
    }
    if (options.tools?.length) {
      body.tools = this._formatToolSchemas(options.tools)
      if (options.toolChoice) body.tool_choice = this._formatToolChoice(options.toolChoice)
    }

    const startTime = Date.now()
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      // 中止会话时立即断掉在途请求（含流式读取），不等网络层超时
      signal: this.getAbortSignal?.()
    })

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 600)
      throw new Error(`Anthropic API ${response.status}: ${detail || response.statusText}`)
    }

    if (!this.stream) {
      const payload = await response.json() as AnthropicFinalMessage
      return this.finalMessageToResponse(payload, startTime)
    }
    if (!response.body) throw new Error('Anthropic API 未返回流式响应体')
    return this.parseStream(response.body, startTime)
  }

  /**
   * AgentScope Msg[] → Anthropic {system, messages}。
   * - system 消息提为顶层 system 块（末块打缓存标）。
   * - 连续同角色消息合并（Messages API 要求 user/assistant 交替）。
   * - tool_result 一律归入 user 消息；tool_call 归入 assistant 的 tool_use。
   * - 最后一条消息的末块打缓存标（历史前缀增量缓存）。
   */
  private formatMessages(msgs: Msg[]): { system: AnthropicBlock[]; messages: AnthropicMessage[] } {
    const system: AnthropicBlock[] = []
    const messages: AnthropicMessage[] = []

    const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
      if (!blocks.length) return
      const last = messages[messages.length - 1]
      if (last && last.role === role) last.content.push(...blocks)
      else messages.push({ role, content: blocks })
    }

    for (const msg of msgs) {
      const blocks = (Array.isArray(msg.content) ? msg.content : []) as MsgBlockLike[]
      if (msg.role === 'system') {
        const text = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n')
        if (text) system.push({ type: 'text', text })
        continue
      }

      const assistantBlocks: AnthropicBlock[] = []
      const userBlocks: AnthropicBlock[] = []
      const target = msg.role === 'assistant' ? assistantBlocks : userBlocks

      for (const block of blocks) {
        switch (block.type) {
          case 'text':
            if (block.text) target.push({ type: 'text', text: block.text })
            break
          case 'thinking':
            // 回传 thinking 需要 signature（未启用扩展思考），跳过
            break
          case 'tool_call':
            assistantBlocks.push({
              type: 'tool_use',
              id: block.id ?? '',
              name: block.name ?? '',
              input: parseToolInput(block.input)
            })
            break
          case 'tool_result':
            userBlocks.push({
              type: 'tool_result',
              tool_use_id: block.id ?? '',
              content: this.toolOutputToBlocks(block.output)
            })
            break
          case 'data': {
            const source = block.source
            if (source?.type === 'base64' && source.media_type?.startsWith('image/')) {
              if (this.supportsVision) {
                target.push({
                  type: 'image',
                  source: { type: 'base64', media_type: source.media_type, data: source.data ?? '' }
                })
              } else {
                target.push({ type: 'text', text: `[图片附件未发送为视觉输入：${block.name ?? 'image'}]` })
              }
            }
            break
          }
        }
      }

      // tool_use 必须先于对应 tool_result：assistant 块先入
      push('assistant', assistantBlocks)
      push('user', userBlocks)
    }

    if (system.length) {
      system[system.length - 1] = { ...system[system.length - 1], cache_control: { type: 'ephemeral' } }
    }
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.content.length) {
      const lastIndex = lastMessage.content.length - 1
      lastMessage.content[lastIndex] = {
        ...lastMessage.content[lastIndex],
        cache_control: { type: 'ephemeral' }
      }
    }
    return { system, messages }
  }

  /** 工具输出（string 或 Text/Data 块数组）→ tool_result content 块 */
  private toolOutputToBlocks(output: unknown): AnthropicBlock[] {
    if (typeof output === 'string') return [{ type: 'text', text: output }]
    if (!Array.isArray(output)) return [{ type: 'text', text: String(output ?? '') }]

    const blocks: AnthropicBlock[] = []
    for (const item of output as MsgBlockLike[]) {
      if (item.type === 'text' && item.text) {
        blocks.push({ type: 'text', text: item.text })
      } else if (
        item.type === 'data'
        && this.supportsVision
        && item.source?.type === 'base64'
        && item.source.media_type?.startsWith('image/')
      ) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: item.source.media_type, data: item.source.data ?? '' }
        })
      }
    }
    return blocks.length ? blocks : [{ type: 'text', text: '' }]
  }

  /**
   * SSE 流解析：yield 增量 ChatResponse，return 累积完整响应。
   * 事件语义：content_block_start 携带块类型与 tool_use 元数据；
   * content_block_delta 携带 text/thinking/input_json 增量；
   * message_start/message_delta 携带 usage。
   */
  private async *parseStream(body: ReadableStream<Uint8Array>, startTime: number): AsyncGenerator<ChatResponse, ChatResponse> {
    let accText = ''
    let accThinking = ''
    // index → tool_use 元数据与入参累积
    const toolMeta = new Map<number, { id: string; name: string }>()
    const toolInputs = new Map<number, string>()
    const blockTypes = new Map<number, string>()
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0

    const usageSnapshot = (): ChatUsage => ({
      type: 'chat_usage',
      // 计费口径：常规输入 + 缓存读写都计入 inputTokens，细分留在 metadata
      inputTokens: inputTokens + cacheReadTokens + cacheCreationTokens,
      outputTokens,
      time: (Date.now() - startTime) / 1000,
      metadata: { cacheReadTokens, cacheCreationTokens }
    })

    for await (const event of parseSseEvents(body)) {
      switch (event.type) {
        case 'message_start': {
          const usage = event.message?.usage
          inputTokens = usage?.input_tokens ?? 0
          cacheReadTokens = usage?.cache_read_input_tokens ?? 0
          cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0
          break
        }
        case 'content_block_start': {
          const index = event.index ?? 0
          const blockType = event.content_block?.type ?? 'text'
          blockTypes.set(index, blockType)
          if (blockType === 'tool_use') {
            toolMeta.set(index, { id: event.content_block?.id ?? '', name: event.content_block?.name ?? '' })
            toolInputs.set(index, '')
          }
          break
        }
        case 'content_block_delta': {
          const index = event.index ?? 0
          const delta = event.delta
          if (!delta) break
          if (delta.type === 'text_delta' && delta.text) {
            accText += delta.text
            yield deltaResponse([{ type: 'text', text: delta.text, id: crypto.randomUUID() }], usageSnapshot())
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            accThinking += delta.thinking
            yield deltaResponse([{ type: 'thinking', thinking: delta.thinking, id: crypto.randomUUID() }], usageSnapshot())
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            toolInputs.set(index, (toolInputs.get(index) ?? '') + delta.partial_json)
            const meta = toolMeta.get(index)
            if (meta) {
              yield deltaResponse([{
                type: 'tool_call',
                id: meta.id,
                name: meta.name,
                input: delta.partial_json,
                state: 'pending'
              }], usageSnapshot())
            }
          }
          break
        }
        case 'message_delta': {
          if (typeof event.usage?.output_tokens === 'number') outputTokens = event.usage.output_tokens
          break
        }
        case 'error': {
          const message = event.error?.message ?? 'Anthropic 流式响应错误'
          logger.warn('stream error event', { message })
          throw new Error(`Anthropic stream error: ${message}`)
        }
      }
    }

    // 组装完整响应（Agent 写入上下文的最终形态）
    const content: ChatResponse['content'] = []
    if (accThinking) content.push({ type: 'thinking', thinking: accThinking, id: crypto.randomUUID() })
    if (accText) content.push({ type: 'text', text: accText, id: crypto.randomUUID() })
    for (const [index, meta] of toolMeta) {
      content.push({
        type: 'tool_call',
        id: meta.id,
        name: meta.name,
        input: toolInputs.get(index) || '{}',
        state: 'pending'
      })
    }
    return {
      type: 'chat',
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      content,
      usage: usageSnapshot()
    }
  }

  /** 非流式响应 → ChatResponse */
  private finalMessageToResponse(payload: AnthropicFinalMessage, startTime: number): ChatResponse {
    const content: ChatResponse['content'] = []
    for (const block of payload.content ?? []) {
      if (block.type === 'text' && block.text) {
        content.push({ type: 'text', text: block.text, id: crypto.randomUUID() })
      } else if (block.type === 'thinking' && block.thinking) {
        content.push({ type: 'thinking', thinking: block.thinking, id: crypto.randomUUID() })
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_call',
          id: block.id ?? '',
          name: block.name ?? '',
          input: JSON.stringify(block.input ?? {}),
          state: 'pending'
        })
      }
    }
    const usage = payload.usage
    return {
      type: 'chat',
      id: payload.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      content,
      usage: {
        type: 'chat_usage',
        inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
        outputTokens: usage?.output_tokens ?? 0,
        time: (Date.now() - startTime) / 1000,
        metadata: {
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0
        }
      }
    }
  }
}

function deltaResponse(content: ChatResponse['content'], usage: ChatUsage): ChatResponse {
  return {
    type: 'chat',
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    content,
    usage
  }
}

function parseToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') return input as Record<string, unknown>
  if (typeof input !== 'string' || !input.trim()) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Anthropic SSE 事件（宽松读取，仅取用到的字段） */
interface AnthropicSseEvent {
  type?: string
  index?: number
  message?: { usage?: AnthropicUsage }
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
  usage?: { output_tokens?: number }
  error?: { message?: string }
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface AnthropicFinalMessage {
  id?: string
  content?: Array<{ type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>
  usage?: AnthropicUsage
}

/** 解析 SSE 字节流为 JSON 事件（data: 行；[DONE] 与 ping 忽略） */
async function* parseSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AnthropicSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separatorIndex = buffer.indexOf('\n\n')
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        separatorIndex = buffer.indexOf('\n\n')

        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
        if (!dataLines.length) continue
        const data = dataLines.join('')
        if (!data || data === '[DONE]') continue
        try {
          yield JSON.parse(data) as AnthropicSseEvent
        } catch {
          // 不完整/损坏的事件：跳过，保持流继续
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 仅测试使用 */
export const anthropicModelInternalsForTest = {
  parseSseEvents,
  parseToolInput
}
