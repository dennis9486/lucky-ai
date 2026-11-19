import { describe, expect, it } from 'vitest'
import { detectMemoryIntents, intentWeight, isMemoryHistoryQuery } from './memory-rules.js'

describe('memory rules', () => {
  it('detects history-oriented memory questions', () => {
    expect(isMemoryHistoryQuery('我的宠物以前叫什么')).toBe(true)
    expect(isMemoryHistoryQuery('what model did I use before?')).toBe(true)
    expect(isMemoryHistoryQuery('我现在喜欢什么编辑器')).toBe(false)
  })

  it('classifies memory query intents across Chinese and English', () => {
    expect(detectMemoryIntents('我喜欢简洁的 UI 风格')).toEqual(new Set(['preference', 'ui']))
    expect(detectMemoryIntents('current project must use browser tool with strict approval')).toEqual(
      new Set(['project', 'constraint', 'tooling'])
    )
  })

  it('keeps intent weights ordered for relevance ranking', () => {
    expect(intentWeight('identity')).toBeGreaterThan(intentWeight('domain'))
    expect(intentWeight('constraint')).toBeGreaterThanOrEqual(intentWeight('workflow'))
  })
})
