import { describe, expect, it } from 'vitest'
import { detectVisionSupport } from './vision-detect.js'

describe('detectVisionSupport', () => {
  it('recognizes known vision model families', () => {
    expect(detectVisionSupport('gpt-4o', 'openai')).toBe(true)
    expect(detectVisionSupport('claude-3-5-sonnet', 'openai')).toBe(true)
    expect(detectVisionSupport('gemini-1.5-pro', 'openai')).toBe(true)
    expect(detectVisionSupport('glm-4.5v', 'openai')).toBe(true)
    expect(detectVisionSupport('qwen2.5-vl-72b', 'openai')).toBe(true)
    expect(detectVisionSupport('llava:13b', 'ollama')).toBe(true)
  })

  it('blocks known text-only / non-vision families', () => {
    expect(detectVisionSupport('deepseek-chat', 'openai')).toBe(false)
    expect(detectVisionSupport('deepseek-reasoner', 'openai')).toBe(false)
    expect(detectVisionSupport('gpt-3.5-turbo', 'openai')).toBe(false)
    expect(detectVisionSupport('text-embedding-3-large', 'openai')).toBe(false)
    expect(detectVisionSupport('bge-m3', 'openai')).toBe(false)
  })

  it('keeps unknown cloud OpenAI-compatible endpoints conservative in auto mode', () => {
    expect(detectVisionSupport('glm-5.2', 'openai')).toBe(false)
    expect(detectVisionSupport('glm-5.1', 'openai')).toBe(false)
    expect(detectVisionSupport('some-new-flagship-2026', 'lmstudio')).toBe(false)
  })

  it('keeps local Ollama conservative (text by default)', () => {
    expect(detectVisionSupport('llama3.1', 'ollama')).toBe(false)
    expect(detectVisionSupport('mistral', 'ollama')).toBe(false)
  })
})
