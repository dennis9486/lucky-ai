import { describe, expect, it } from 'vitest'
import { repairToolCallPairing } from './tool-call-pairing.js'

const assistant = (...ids: string[]): Record<string, unknown> => ({
  role: 'assistant',
  content: '',
  tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'Read', arguments: '{}' } }))
})
const toolResult = (id: string): Record<string, unknown> => ({ role: 'tool', tool_call_id: id, content: 'ok' })
const ids = (msgs: Record<string, unknown>[]): unknown[] =>
  msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)

describe('repairToolCallPairing', () => {
  it('补齐被中断、缺失的 tool 响应', () => {
    const out = repairToolCallPairing([
      { role: 'user', content: 'hi' },
      assistant('call_1')
    ])
    expect(out).toHaveLength(3)
    expect(out[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
    expect(typeof out[2].content).toBe('string')
  })

  it('只补缺失的那一个，不动已应答的', () => {
    const out = repairToolCallPairing([assistant('a', 'b'), toolResult('a')])
    expect(ids(out)).toEqual(['a', 'b'])
    expect(out[1]).toMatchObject({ content: 'ok' }) // 已有响应原样保留
  })

  it('配对完整时原样返回', () => {
    const input = [assistant('a'), toolResult('a'), { role: 'assistant', content: '完成' }]
    expect(repairToolCallPairing(input)).toEqual(input)
  })

  it('丢弃没有前置 tool_calls 的游离 tool 消息', () => {
    const out = repairToolCallPairing([{ role: 'user', content: 'hi' }, toolResult('ghost')])
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('丢弃 id 不匹配/重复的 tool 消息', () => {
    const out = repairToolCallPairing([assistant('a'), toolResult('a'), toolResult('a'), toolResult('x')])
    expect(ids(out)).toEqual(['a'])
  })

  it('普通多轮对话不受影响', () => {
    const input = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ]
    expect(repairToolCallPairing(input)).toEqual(input)
  })
})
