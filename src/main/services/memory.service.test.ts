import { describe, expect, it } from 'vitest'
import { memoryInternalsForTest } from './memory.service.js'

describe('memory v2 slot semantics', () => {
  it('derives a stable generic relation slot for current and previous facts', () => {
    const first = memoryInternalsForTest.memoryFactCandidate('我的宠物叫小白')
    const next = memoryInternalsForTest.memoryFactCandidate('不对，现在我的宠物叫汪汪')

    expect(first.content).toBe('我的宠物叫小白')
    expect(first.slot).toBe('personal:宠物:name')
    expect(next.content).toBe('我的宠物叫汪汪')
    expect(next.slot).toBe(first.slot)
  })

  it('detects historical queries without treating them as memory updates', () => {
    expect(memoryInternalsForTest.isMemoryHistoryQuery('我的宠物以前叫什么')).toBe(true)
    expect(memoryInternalsForTest.memoryFactCandidate('我的宠物以前叫什么').content).toBeNull()
  })

  it('local similarity separates paraphrases from conflicting facts and noise', () => {
    const sim = memoryInternalsForTest.memorySimilarity
    const paraphrase = sim('我喜欢用 pnpm 作为包管理器', '我喜欢使用 pnpm 作为包管理器')
    const conflict = sim('我的宠物叫小白', '我的宠物叫汪汪')
    const unrelated = sim('项目默认使用 pnpm', '今天天气很好')

    // 同义改写应判为近重复（≥ 去重阈值 0.7），冲突事实（值不同）必须低于阈值以保留供 slot 逻辑处理
    expect(paraphrase).toBeGreaterThanOrEqual(0.7)
    expect(conflict).toBeLessThan(0.7)
    expect(paraphrase).toBeGreaterThan(conflict)
    expect(conflict).toBeGreaterThan(unrelated)
    expect(sim('完全一样的文本', '完全一样的文本')).toBeCloseTo(1, 5)
    expect(unrelated).toBeLessThan(0.2)
  })

  it('decides ADD vs REINFORCE like mem0 (compare-before-insert)', () => {
    const decide = memoryInternalsForTest.decideMemoryWrite

    // 同义改写 → 复用已有（不新增冗余）
    const paraphrase = decide(
      { content: '我喜欢用 pnpm 作为包管理器', slot: null },
      [{ id: 'a', content: '我喜欢使用 pnpm 作为包管理器', slot: null }]
    )
    expect(paraphrase.op).toBe('reinforce')
    expect(paraphrase).toMatchObject({ targetId: 'a' })

    // 同 slot、值不同（冲突更新）→ 新增，交给 slot 逻辑 supersede，绝不并入
    expect(decide(
      { content: '我的宠物叫汪汪', slot: 'personal:宠物:name' },
      [{ id: 'a', content: '我的宠物叫小白', slot: 'personal:宠物:name' }]
    ).op).toBe('add')

    // 不同 slot（不同主题）→ 永不跨主题合并
    expect(decide(
      { content: '我的宠物叫小白', slot: 'personal:宠物:name' },
      [{ id: 'a', content: '我的编辑器用 vscode', slot: 'personal:编辑器:uses' }]
    ).op).toBe('add')

    // 无相似项 / 无已有记忆 → 新增
    expect(decide({ content: '项目默认使用 pnpm', slot: null }, [{ id: 'a', content: '今天天气很好', slot: null }]).op).toBe('add')
    expect(decide({ content: 'anything new', slot: null }, []).op).toBe('add')
  })

  it('builds language-agnostic structured facts from memory slots', () => {
    expect(memoryInternalsForTest.buildStructuredFact('我的宠物叫小白')?.value).toBe('小白')

    const english = memoryInternalsForTest.buildStructuredFact('my editor uses vscode')
    expect(english).toMatchObject({
      namespace: 'personal',
      subject: '编辑器',
      relation: 'uses',
      value: 'vscode'
    })
  })
})
