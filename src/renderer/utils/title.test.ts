import { describe, expect, it } from 'vitest'
import { compactGeneratedTitle, normalizeGeneratedTitleText } from './title.js'

describe('title utilities', () => {
  it('removes IME apostrophe separators from generated English words', () => {
    expect(normalizeGeneratedTitleText("帮我 收集 w'o'r'l'd'quan't 的资料")).toBe('帮我 收集 worldquant 的资料')
  })

  it('keeps ordinary apostrophe words readable', () => {
    expect(normalizeGeneratedTitleText("don't reset John's branch")).toBe("don't reset John's branch")
  })

  it('falls back when compacted title is empty', () => {
    expect(compactGeneratedTitle('   ', '新对话', 20)).toBe('新对话')
  })
})
