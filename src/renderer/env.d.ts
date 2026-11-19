/// <reference types="vite/client" />

import type { LuckyAIBridge } from '../../preload/index.js'
import type { ChatCompletionChunk } from '../../shared/types/ai.js'

declare global {
  interface Window {
    luckyAI: LuckyAIBridge
  }
}

export {}

export type { LuckyAIBridge, ChatCompletionChunk }
