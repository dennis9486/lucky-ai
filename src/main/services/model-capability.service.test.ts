import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeModelCapabilities, modelCapabilityInternalsForTest } from './model-capability.service.js'
import type { AIProviderConfig } from '../../shared/types/ai.js'

const { describeProbeError, buildProfile } = modelCapabilityInternalsForTest

afterEach(() => {
  vi.restoreAllMocks()
})

function provider(overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
  return {
    id: 'p1',
    type: 'openai',
    name: 'Test',
    baseUrl: 'https://api.test.local/v1',
    apiKey: 'k',
    model: 'm',
    enabled: true,
    ...overrides
  }
}

describe('describeProbeError', () => {
  it('maps vision rejection to a clear reason', () => {
    expect(describeProbeError('vision', 'Invalid content type: image_url is not supported'))
      .toBe('该模型不支持图片输入（image_url 被拒绝）')
  })

  it('maps tools and json rejections', () => {
    expect(describeProbeError('tools', '"tools" is not supported by this model')).toContain('工具调用')
    expect(describeProbeError('jsonOutput', 'response_format not available')).toContain('JSON 输出')
  })

  it('maps auth failures regardless of probe kind', () => {
    expect(describeProbeError('streaming', 'HTTP 401 Unauthorized')).toBe('API Key 无效或无权限')
  })
})

describe('buildProfile', () => {
  it('marks passed probes true and collects failure reasons', () => {
    const profile = buildProfile({
      streaming: null,
      tools: 'tools not supported',
      vision: null,
      jsonOutput: null
    })
    expect(profile).toMatchObject({ streaming: true, tools: false, vision: true, jsonOutput: true })
    expect(profile.errors?.tools).toContain('工具调用')
    expect(profile.detectedAt).toBeGreaterThan(0)
  })
})

describe('probeModelCapabilities (openai-compatible)', () => {
  it('probes four capabilities in parallel and reflects per-probe outcomes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
      // 拒绝 vision 探测，其余通过
      if (Array.isArray((body.messages as Array<{ content: unknown }>)[0]?.content)) {
        return new Response('{"error":{"message":"image_url is not supported"}}', { status: 400 })
      }
      return new Response('{"choices":[]}', { status: 200 })
    })

    const profile = await probeModelCapabilities(provider(), 'test-model')
    expect(profile.vision).toBe(false)
    expect(profile.tools).toBe(true)
    expect(profile.streaming).toBe(true)
    expect(profile.jsonOutput).toBe(true)
    expect(profile.errors?.vision).toBe('该模型不支持图片输入（image_url 被拒绝）')
  })

  it('uses ollama /api/show capabilities when available', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/show')) {
        return new Response(JSON.stringify({ capabilities: ['completion', 'tools'] }), { status: 200 })
      }
      throw new Error('unexpected request')
    })

    const profile = await probeModelCapabilities(provider({ type: 'ollama', baseUrl: 'http://127.0.0.1:11434' }), 'qwen3')
    expect(profile.tools).toBe(true)
    expect(profile.vision).toBe(false)
    expect(profile.errors?.vision).toContain('vision')
  })
})
