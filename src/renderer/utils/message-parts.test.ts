import { describe, expect, it } from 'vitest'
import { syncViewParts } from './message-parts.js'
import type { MessagePart } from '../../shared/types/ai.js'

const text = (t: string): MessagePart => ({ type: 'text', text: t })
const tool = (over: Partial<Extract<MessagePart, { type: 'tool' }>> = {}): MessagePart => ({
  type: 'tool',
  id: 't1',
  name: 'Bash',
  output: '',
  status: 'running',
  ...over
})

describe('syncViewParts', () => {
  it('reuses object identity for unchanged parts', () => {
    const working: MessagePart[] = [text('hello'), tool({ output: 'a' })]
    const first = syncViewParts([], working)
    // 无任何变化再同步一次：应逐个复用 first 的对象身份
    const second = syncViewParts(first, working)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('produces a new identity only for the grown text part', () => {
    const working: MessagePart[] = [text('hel')]
    const first = syncViewParts([], working)
    ;(working[0] as { text: string }).text = 'hello' // 追加增长（就地）
    const second = syncViewParts(first, working)
    expect(second[0]).not.toBe(first[0])
    expect((second[0] as { text: string }).text).toBe('hello')
  })

  it('keeps earlier parts stable while only the tail changes', () => {
    const working: MessagePart[] = [text('stable'), text('gr')]
    const first = syncViewParts([], working)
    ;(working[1] as { text: string }).text = 'grow'
    const second = syncViewParts(first, working)
    expect(second[0]).toBe(first[0]) // 前一片段身份不变 → 不触发重渲染
    expect(second[1]).not.toBe(first[1])
  })

  it('detects tool status / output changes', () => {
    const working: MessagePart[] = [tool({ output: 'a', status: 'running' })]
    const first = syncViewParts([], working)
    ;(working[0] as { output: string }).output = 'ab'
    const second = syncViewParts(first, working)
    expect(second[0]).not.toBe(first[0])
    ;(working[0] as { status: string }).status = 'success'
    const third = syncViewParts(second, working)
    expect(third[0]).not.toBe(second[0])
  })

  it('handles newly appended parts and shrinking arrays', () => {
    const a: MessagePart[] = [text('x')]
    const first = syncViewParts([], a)
    const b: MessagePart[] = [a[0]!, tool()]
    const second = syncViewParts(first, b)
    expect(second[0]).toBe(first[0])
    expect(second.length).toBe(2)
    const third = syncViewParts(second, [a[0]!])
    expect(third.length).toBe(1)
    expect(third[0]).toBe(first[0])
  })
})
