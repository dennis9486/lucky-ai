import type { AIModelConfig, AIProviderConfig, AIProviderType } from './types/ai.js'

export interface ModelProviderPreset {
  id: string
  vendor: string
  name: string
  type: AIProviderType
  badge: 'local' | 'cloud' | 'router'
  baseUrl: string
  models: Array<string | Pick<AIModelConfig, 'name' | 'vision'>>
  defaultModel: string
  requiresApiKey: boolean
  descriptionKey: 'ollama' | 'openaiCompatible' | 'lmstudio' | 'anthropic'
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'ollama',
    vendor: 'ollama',
    name: 'Ollama (Local)',
    type: 'ollama',
    badge: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['llama3.2'],
    defaultModel: 'llama3.2',
    requiresApiKey: false,
    descriptionKey: 'ollama'
  },
  {
    id: 'openai',
    vendor: 'openai',
    name: 'OpenAI',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { name: 'gpt-4o-mini', vision: 'on' },
      { name: 'gpt-4.1-mini', vision: 'auto' },
      { name: 'gpt-4o', vision: 'on' }
    ],
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'anthropic',
    vendor: 'anthropic',
    name: 'Anthropic Claude',
    type: 'anthropic',
    badge: 'cloud',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { name: 'claude-sonnet-4-5', vision: 'on' },
      { name: 'claude-opus-4-1', vision: 'on' },
      { name: 'claude-haiku-4-5', vision: 'on' }
    ],
    defaultModel: 'claude-sonnet-4-5',
    requiresApiKey: true,
    descriptionKey: 'anthropic'
  },
  {
    id: 'gemini',
    vendor: 'gemini',
    name: 'Google Gemini',
    type: 'openai',
    badge: 'cloud',
    // Gemini 官方 OpenAI 兼容端点：走既有 openai 通道，无需独立协议实现
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { name: 'gemini-2.5-flash', vision: 'on' },
      { name: 'gemini-2.5-pro', vision: 'on' }
    ],
    defaultModel: 'gemini-2.5-flash',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'deepseek',
    vendor: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { name: 'deepseek-chat', vision: 'off' },
      { name: 'deepseek-reasoner', vision: 'off' }
    ],
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'bigmodel',
    vendor: 'bigmodel',
    name: '智谱 BigModel',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { name: 'glm-4.5', vision: 'auto' },
      { name: 'glm-4.5v', vision: 'on' },
      { name: 'glm-4-flash', vision: 'auto' }
    ],
    defaultModel: 'glm-4.5',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'dashscope',
    vendor: 'dashscope',
    name: '阿里云百炼 DashScope',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { name: 'qwen-plus', vision: 'auto' },
      { name: 'qwen-max', vision: 'auto' },
      { name: 'qwen-vl-plus', vision: 'on' }
    ],
    defaultModel: 'qwen-plus',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'volcengine',
    vendor: 'volcengine',
    name: '火山方舟 豆包',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { name: 'doubao-seed-1-6-250615', vision: 'on' },
      { name: 'doubao-seed-1-6-flash-250615', vision: 'on' }
    ],
    defaultModel: 'doubao-seed-1-6-250615',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'xai',
    vendor: 'xai',
    name: 'xAI Grok',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      { name: 'grok-4', vision: 'on' },
      { name: 'grok-3-mini', vision: 'off' }
    ],
    defaultModel: 'grok-4',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'moonshot',
    vendor: 'moonshot',
    name: 'Moonshot Kimi',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-8k'],
    defaultModel: 'kimi-k2-0711-preview',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'siliconflow',
    vendor: 'siliconflow',
    name: 'SiliconFlow',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3'],
    defaultModel: 'Qwen/Qwen3-235B-A22B',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'openrouter',
    vendor: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    badge: 'router',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { name: 'openai/gpt-4o-mini', vision: 'on' },
      { name: 'anthropic/claude-3.5-sonnet', vision: 'on' }
    ],
    defaultModel: 'openai/gpt-4o-mini',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  },
  {
    id: 'lmstudio',
    vendor: 'lmstudio',
    name: 'LM Studio',
    type: 'lmstudio',
    badge: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    defaultModel: 'local-model',
    requiresApiKey: false,
    descriptionKey: 'lmstudio'
  },
  {
    id: 'custom-openai',
    vendor: 'custom',
    name: 'Custom OpenAI Compatible',
    type: 'openai',
    badge: 'cloud',
    baseUrl: 'https://api.example.com/v1',
    models: ['model-name'],
    defaultModel: 'model-name',
    requiresApiKey: true,
    descriptionKey: 'openaiCompatible'
  }
]

export function presetById(id: string | undefined): ModelProviderPreset {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? MODEL_PROVIDER_PRESETS[0]!
}

export function presetByVendor(vendor: string | undefined): ModelProviderPreset | undefined {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.vendor === vendor)
}

export function providerFromPreset(
  presetId: string,
  options: { id?: string; enabled?: boolean; name?: string } = {}
): AIProviderConfig {
  const preset = presetById(presetId)
  const id = options.id ?? `${preset.id}-${Date.now().toString(36)}`
  const models = preset.models.map((model, index) => {
    const name = typeof model === 'string' ? model : model.name
    return {
      id: `${id}-model-${index}`,
      name,
      enabled: true,
      vision: (typeof model === 'string' ? undefined : model.vision) ?? 'auto'
    }
  })
  const active = models.find((model) => model.name === preset.defaultModel) ?? models[0]!

  return {
    id,
    type: preset.type,
    vendor: preset.vendor,
    name: options.name ?? preset.name,
    baseUrl: preset.baseUrl,
    apiKey: preset.requiresApiKey ? '' : undefined,
    model: active.name,
    models,
    activeModelId: active.id,
    enabled: options.enabled ?? false
  }
}

export function defaultModelProviders(): AIProviderConfig[] {
  return [
    providerFromPreset('ollama', { id: 'ollama-default', enabled: true }),
    providerFromPreset('openai', { id: 'openai-default', enabled: false, name: 'OpenAI Compatible' }),
    providerFromPreset('lmstudio', { id: 'lmstudio-default', enabled: false })
  ]
}
