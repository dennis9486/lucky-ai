import { describe, expect, it } from 'vitest'
import { defaultModelProviders, providerFromPreset } from './model-provider-presets.js'

describe('model provider presets', () => {
  it('builds default providers from shared presets', () => {
    const providers = defaultModelProviders()
    expect(providers.map((provider) => provider.id)).toEqual([
      'ollama-default',
      'openai-default',
      'lmstudio-default'
    ])
    expect(providers[0]).toMatchObject({
      type: 'ollama',
      vendor: 'ollama',
      enabled: true,
      model: 'llama3.2'
    })
  })

  it('creates OpenAI-compatible cloud vendors without changing the runtime protocol', () => {
    const provider = providerFromPreset('deepseek', { id: 'deepseek-test', enabled: true })
    expect(provider).toMatchObject({
      id: 'deepseek-test',
      type: 'openai',
      vendor: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      enabled: true
    })
    expect(provider.models?.map((model) => model.name)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(provider.models?.map((model) => model.vision)).toEqual(['off', 'off'])
  })
})
