import type { LuckyAIBridge } from './index'

declare global {
  interface Window {
    luckyAI: LuckyAIBridge
  }
}

export {}
