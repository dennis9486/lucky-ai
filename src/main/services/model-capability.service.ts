/**
 * model-capability.service.ts — 模型能力实测探测
 *
 * 目标：能力档案靠**实际请求**而非模型名猜测——探测 vision / tools /
 * streaming / JSON 输出四项，失败时给出用户可读的明确原因（如
 * "该模型不支持 image_url 输入"），结果作为 ModelCapabilityProfile
 * 存入模型配置，供 model-factory 的视觉判定与错误提示消费。
 *
 * 策略（按 provider 协议分派）：
 * - ollama：优先 /api/show 读官方 capabilities 数组（零成本、权威）；
 *   缺失时回退到探测请求。
 * - openai/lmstudio（OpenAI 兼容）：四项各发一个最小请求（max_tokens=1，
 *   1x1 像素图），并行执行，单项 15s 超时。
 * - anthropic：Claude 全系支持四项，仅发一次最小请求验证连通/凭证。
 *
 * 成本护栏：每次探测最多 4 个请求、每个 max_tokens=1。
 */

import type { AIProviderConfig, ModelCapabilityProfile } from '../../shared/types/ai.js'
import { createLogger } from '../../shared/utils/log.js'
import { isDev } from '../app-env.js'

const PROBE_TIMEOUT_MS = 15_000

/** 1x1 透明 PNG（最小合法图片输入） */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const logger = createLogger('main/model-capability', {
  debugEnabled: isDev
})

/** 探测项失败原因的用户可读归纳 */
function describeProbeError(kind: string, raw: string): string {
  // 已本地化的终态原因（如 ollama /api/show 声明式结果）直接透传，不再套探测式改写
  if (/^[一-鿿]/.test(raw)) return raw
  const lower = raw.toLowerCase()
  if (kind === 'vision' && /image_url|image|vision|multimodal|content.*type/.test(lower)) {
    return '该模型不支持图片输入（image_url 被拒绝）'
  }
  if (kind === 'tools' && /tool|function/.test(lower)) {
    return '该模型不支持工具调用（tools 参数被拒绝）'
  }
  if (kind === 'jsonOutput' && /response_format|json/.test(lower)) {
    return '该模型不支持 JSON 输出模式（response_format 被拒绝）'
  }
  if (/401|unauthorized|api key/i.test(raw)) return 'API Key 无效或无权限'
  if (/timeout|abort/i.test(lower)) return `探测超时（${PROBE_TIMEOUT_MS / 1000}s）`
  const firstLine = raw.split('\n')[0] ?? raw
  return firstLine.slice(0, 200)
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 单项探测：成功返回 null，失败返回原因 */
type ProbeOutcome = string | null

async function probeOpenAiCompatible(
  provider: AIProviderConfig,
  model: string
): Promise<ModelCapabilityProfile> {
  const baseUrl = provider.baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
  }

  const post = async (body: Record<string, unknown>): Promise<ProbeOutcome> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, max_tokens: 1, ...body })
      })
      if (response.ok) return null
      return (await response.text().catch(() => '')).slice(0, 500) || `HTTP ${response.status}`
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const ping = [{ role: 'user', content: 'ping' }]
  const [streaming, tools, vision, jsonOutput] = await Promise.all([
    post({ messages: ping, stream: true }),
    post({
      messages: ping,
      tools: [{
        type: 'function',
        function: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: {} } }
      }]
    }),
    post({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } }
        ]
      }]
    }),
    post({ messages: [{ role: 'user', content: 'return an empty json object' }], response_format: { type: 'json_object' } })
  ])

  return buildProfile({ streaming, tools, vision, jsonOutput })
}

/** ollama：优先 /api/show 的官方 capabilities；回退探测 */
async function probeOllama(provider: AIProviderConfig, model: string): Promise<ModelCapabilityProfile> {
  const baseUrl = provider.baseUrl.replace(/\/$/, '')
  try {
    const response = await fetchWithTimeout(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model })
    })
    if (response.ok) {
      const payload = await response.json() as { capabilities?: string[] }
      if (Array.isArray(payload.capabilities)) {
        const has = (cap: string) => payload.capabilities!.includes(cap)
        return buildProfile({
          streaming: null, // ollama chat 全面支持流式
          tools: has('tools') ? null : '模型未声明 tools 能力（ollama /api/show）',
          vision: has('vision') ? null : '模型未声明 vision 能力（ollama /api/show）',
          jsonOutput: null // ollama 支持 format=json
        })
      }
    }
  } catch (e) {
    logger.debug('ollama /api/show failed, falling back to probes', { error: String(e) })
  }
  // 回退：老版本 ollama 走 OpenAI 兼容端点探测
  return probeOpenAiCompatible({ ...provider, baseUrl: `${baseUrl}/v1` }, model)
}

/** anthropic：全系支持四项，只验证连通与凭证 */
async function probeAnthropic(provider: AIProviderConfig, model: string): Promise<ModelCapabilityProfile> {
  let error: ProbeOutcome = null
  try {
    const response = await fetchWithTimeout(`${provider.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    })
    if (!response.ok) error = (await response.text().catch(() => '')).slice(0, 500) || `HTTP ${response.status}`
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return buildProfile({ streaming: error, tools: error, vision: error, jsonOutput: error })
}

function buildProfile(outcomes: {
  streaming: ProbeOutcome
  tools: ProbeOutcome
  vision: ProbeOutcome
  jsonOutput: ProbeOutcome
}): ModelCapabilityProfile {
  const errors: Record<string, string> = {}
  for (const [kind, outcome] of Object.entries(outcomes)) {
    if (outcome !== null) errors[kind] = describeProbeError(kind, outcome)
  }
  return {
    streaming: outcomes.streaming === null,
    tools: outcomes.tools === null,
    vision: outcomes.vision === null,
    jsonOutput: outcomes.jsonOutput === null,
    detectedAt: Date.now(),
    ...(Object.keys(errors).length ? { errors } : {})
  }
}

/** 探测指定 Provider 下某个模型的能力档案（4 项并行，最多 4 个最小请求） */
export async function probeModelCapabilities(
  provider: AIProviderConfig,
  model: string
): Promise<ModelCapabilityProfile> {
  logger.info('probe model capabilities', { provider: provider.name, type: provider.type, model })
  switch (provider.type) {
    case 'ollama':
      return probeOllama(provider, model)
    case 'anthropic':
      return probeAnthropic(provider, model)
    default:
      return probeOpenAiCompatible(provider, model)
  }
}

/** 仅测试使用 */
export const modelCapabilityInternalsForTest = {
  describeProbeError,
  buildProfile
}
