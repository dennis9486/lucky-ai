/**
 * model-factory.ts — AI 模型工厂模块
 *
 * 职责：根据用户的 Provider 配置创建 AgentScope ChatModel 实例，同时注入
 *       自定义 formatter（多模态支持）和 schema 清洗/思考模式修复装饰器。
 *
 * 架构：
 * - createChatModel() 作为单一入口，根据 provider.type 分发到 Ollama 或
 *   OpenAI-compatible（含 LM Studio）的实现。
 * - 每个 model 被以下装饰器链包装（从内到外）：
 *   1. 自定义 Formatter（多模态消息格式化）
 *   2. withSchemaSanitizer（工具 schema draft-07 清洗，防 400 错误）
 *   3. withReasoningRoundTrip（DeepSeek 思考模式修复，仅 OpenAI 路径）
 *
 * 多模态策略：
 * - 通过 active model 的多模态配置和 supportsVisionInput() 嗅探模型名，判断是否具备视觉能力。
 * - 对于不具备视觉能力的模型，将图片附件自动替换为文本占位提示，而非静默丢弃。
 */

import type { AIProviderConfig } from '../../shared/types/ai.js'
import { OpenAIChatModel, OllamaChatModel } from '@agentscope-ai/agentscope/model'
import type { ChatModelBase } from '@agentscope-ai/agentscope/model'
import { OllamaChatFormatter, OpenAIChatFormatter } from '@agentscope-ai/agentscope/formatter'
import { getContentBlocks, getTextContent } from '@agentscope-ai/agentscope/message'
import type { DataBlock, Msg } from '@agentscope-ai/agentscope/message'
import { sanitizeToolSchemas } from './json-schema.js'
import { withReasoningRoundTrip } from './reasoning-roundtrip.js'
import { withClientAbort, withRequestAbortSignal } from './abort-signal.js'
import { detectVisionSupport } from './vision-detect.js'
import { AnthropicChatModel } from './anthropic-model.js'

export interface CreateChatModelOptions {
  /** 当前轮的中止信号（按会话动态取）：中止时立即断掉在途模型请求 */
  getAbortSignal?: () => AbortSignal | undefined
}

/**
 * 根据 Provider 配置创建 AgentScope ChatModel。
 *
 * 工厂策略：
 * - ollama → OllamaChatModel + LuckyOllamaMultimodalFormatter
 * - lmstudio/openai → OpenAIChatModel + LuckyOpenAICompatibleFormatter
 *                      + withReasoningRoundTrip（思考模式修复）
 * - 所有类型 → withSchemaSanitizer 装饰（tool schema draft-07 清洗）
 *
 * @param provider - AI Provider 配置（type, model, baseUrl, apiKey 等）
 * @returns 配置完成的 ChatModelBase 实例
 * @throws 不支持的 provider.type
 */
export function createChatModel(provider: AIProviderConfig, options: CreateChatModelOptions = {}): ChatModelBase {
  const getAbortSignal = options.getAbortSignal ?? (() => undefined)
  switch (provider.type) {
    case 'ollama':
      // ollama-js 不支持每请求 signal：中止时经 client.abort() 断掉在途流
      return withClientAbort(
        withSchemaSanitizer(
          new OllamaChatModel({
            modelName: provider.model,
            host: provider.baseUrl.replace(/\/$/, ''),
            stream: true,
            formatter: new LuckyOllamaMultimodalFormatter({
              supportsVision: supportsVisionInput(provider)
            })
          })
        ),
        getAbortSignal
      )

    case 'lmstudio':
    case 'openai':
      return withReasoningRoundTrip(
        withSchemaSanitizer(
          // signal 作为 openai SDK 请求选项传入：中止即断流（APIUserAbortError）
          withRequestAbortSignal(
            new OpenAIChatModel({
              modelName: provider.model,
              apiKey: provider.apiKey ?? 'not-needed',
              baseURL: provider.baseUrl.replace(/\/$/, ''),
              stream: true,
              formatter: new LuckyOpenAICompatibleFormatter({
                supportsVision: supportsVisionInput(provider)
              })
            }),
            getAbortSignal
          )
        )
      )

    case 'anthropic':
      // 原生 Messages API：prompt caching + 原生工具流（消息映射在模型内完成，不挂 formatter）
      return withSchemaSanitizer(
        new AnthropicChatModel({
          modelName: provider.model,
          apiKey: provider.apiKey ?? '',
          baseUrl: provider.baseUrl,
          supportsVision: supportsVisionInput(provider),
          stream: true,
          getAbortSignal
        })
      )

    default:
      throw new Error(`不支持的 Provider 类型: ${provider.type}`)
  }
}

/**
 * OpenAI 兼容格式的自定义多模态 Formatter。
 *
 * 在标准 OpenAIChatFormatter 基础上增加：
 * - 对非视觉模型：将图片 DataBlock 替换为文本提示，避免 API 报错。
 * - 对视觉模型：透传给父类处理。
 *
 * 覆盖方法：_formatMultimodalBlock（单个模态块格式化的钩子方法）。
 */
class LuckyOpenAICompatibleFormatter extends OpenAIChatFormatter {
  constructor(private readonly options: { supportsVision: boolean }) {
    super()
  }

  override async _formatMultimodalBlock({
    block,
    role
  }: {
    block: DataBlock
    role: Msg['role']
  }): Promise<Record<string, unknown>[]> {
    const mediaKind = block.source.media_type.split('/')[0]
    if (mediaKind === 'image' && !this.options.supportsVision) {
      // 非视觉模型：将图片块替换为说明文本，提示用户更换模型
      return [{
        type: 'text',
        text: `[图片附件未发送为视觉输入：${block.name ?? 'image'}。当前模型未声明视觉能力，请切换到支持图片理解的模型后再要求分析图片内容。]`
      }]
    }

    return super._formatMultimodalBlock({ block, role })
  }
}

/**
 * Ollama 自定义多模态 Formatter。
 *
 * Ollama Chat API 的消息格式与 OpenAI 不同：图片以 base64 data 直接嵌入
 * 消息对象的 `images` 数组字段，而非 content 中的多部分结构。
 *
 * 处理逻辑：
 * 1. 消息文本 → `content` 字段。
 * 2. 图片 DataBlock → `images` 数组（base64 数据）。
 * 3. 工具调用 → `tool_calls` 数组（OpenAI 兼容格式）。
 * 4. 工具结果 → 独立的 `role: tool` 消息。
 */
class LuckyOllamaMultimodalFormatter extends OllamaChatFormatter {
  constructor(private readonly options: { supportsVision: boolean }) {
    super()
  }

  async format({ msgs }: { msgs: Msg[] }): Promise<Record<string, unknown>[]> {
    const formattedMsgs: Array<Record<string, unknown>> = []

    for (const msg of msgs) {
      const formattedMsg: {
        role: string
        content: string
        images?: string[]
        tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
      } = {
        role: msg.role,
        content: getTextContent(msg) ?? ''
      }

      // ── 图片处理 ──────────────────────────────────────────
      // 提取所有 base64 图片块
      const imageBlocks = getContentBlocks(msg, 'data')
        .filter((block) => block.source.media_type.startsWith('image/') && block.source.type === 'base64')
      if (imageBlocks.length) {
        if (this.options.supportsVision) {
          // 视觉模型：将 base64 数据放入 images 数组
          formattedMsg.images = imageBlocks.map((block) =>
            block.source.type === 'base64' ? block.source.data : ''
          ).filter(Boolean)
        } else {
          // 非视觉模型：替换为文本提示
          formattedMsg.content = `${formattedMsg.content}\n\n${imageBlocks
            .map((block) => `[图片附件未发送为视觉输入：${block.name ?? 'image'}。当前模型未声明视觉能力，请切换到支持图片理解的模型后再要求分析图片内容。]`)
            .join('\n')}`.trim()
        }
      }

      // ── 工具调用 ──────────────────────────────────────────
      const toolCalls = getContentBlocks(msg, 'tool_call')
      if (toolCalls.length > 0) {
        formattedMsg.tool_calls = toolCalls.map((toolCall) => ({
          function: {
            name: toolCall.name,
            arguments: JSON.parse(toolCall.input) as Record<string, unknown>
          }
        }))
      }

      // ── 工具结果 ──────────────────────────────────────────
      const toolResults = getContentBlocks(msg, 'tool_result')
      for (const toolResult of toolResults) {
        const resultText = this.convertToolOutputToString(toolResult.output, false)
        formattedMsgs.push({
          role: 'tool',
          content: resultText.text
        })
      }

      // 仅当消息有实质内容时才加入
      if (formattedMsg.content || formattedMsg.images?.length || formattedMsg.tool_calls) {
        formattedMsgs.push(formattedMsg)
      }
    }

    return formattedMsgs
  }
}

/**
 * Schema 清洗装饰器：在 model.call 这一收口处清洗工具 schema。
 *
 * 无论工具来自 Toolkit 还是结构化输出（callStructured），所有送往模型的
 * tools 数组都会经过 sanitizeToolSchemas 的 draft-07 清洗，规避 DeepSeek
 * 等严格校验导致的 400 "true is not of type number"。
 *
 * 实现方式：通过替换 model.call 方法实现 AOP 切面，不修改 model 原型。
 *
 * @param model - 待装饰的 ChatModelBase 实例
 * @returns 同一实例（mutated），call 方法已注入 schema 清洗逻辑
 */
function withSchemaSanitizer<T extends ChatModelBase>(model: T): T {
  const target = model as unknown as {
    call: (options: { tools?: unknown }, ...rest: unknown[]) => unknown
  }
  const original = target.call.bind(model)
  target.call = (options, ...rest) => {
    if (options && typeof options === 'object' && 'tools' in options) {
      sanitizeToolSchemas(options.tools)
    }
    return original(options, ...rest)
  }
  return model
}

/**
 * 嗅探 Provider 是否支持视觉（图片）输入。
 *
 * 策略：
 * 1. 如果识别到 DeepSeek（不支持图片），直接返回 false。
 * 2. 根据 `provider.name + baseUrl + model` 拼接的字符串匹配已知视觉模型
 *    关键词正则列表。
 *
 * 注意：此启发式方法可能存在误判，但可覆盖绝大多数主流模型。
 * 对于自定义模型/代理，如果模型名包含 vision/vl 等关键词也会返回 true。
 *
 * @param provider - AI Provider 配置
 * @returns 是否支持视觉输入
 */
/**
 * 判断 Provider 当前模型是否可接收多模态图片内容。
 * 优先级：实测能力档案（capabilities.vision）＞ 显式多模态配置（on/off）＞
 * vision-detect 名字启发式（兜底，可能误判）。
 */
function supportsVisionInput(provider: AIProviderConfig): boolean {
  const active =
    provider.models?.find((model) => model.id === provider.activeModelId) ??
    provider.models?.find((model) => model.name === provider.model)
  if (active?.capabilities?.detectedAt) return active.capabilities.vision
  if (active?.vision === 'on') return true
  if (active?.vision === 'off') return false
  return detectVisionSupport(`${provider.name} ${provider.baseUrl} ${provider.model}`, provider.type)
}
