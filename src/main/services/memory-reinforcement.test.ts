import { describe, expect, it } from 'vitest'
import { memorySalience, rankMemoryRows, reinforcementScore, type MemoryRow } from './memory-retrieval.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe('reinforcementScore (recency + frequency)', () => {
  it('is 0 for a never-used memory', () => {
    expect(reinforcementScore({ lastUsedAt: null, useCount: 0, now: NOW })).toBe(0)
  })

  it('is bounded within [0, 1]', () => {
    const samples = [
      { lastUsedAt: NOW, useCount: 1_000_000, now: NOW },
      { lastUsedAt: NOW - 365 * DAY, useCount: 0, now: NOW },
      { lastUsedAt: null, useCount: 0, now: NOW }
    ]
    for (const s of samples) {
      const v = reinforcementScore(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('decays recency with a 7-day half-life', () => {
    const fresh = reinforcementScore({ lastUsedAt: NOW, useCount: 0, now: NOW })
    const week = reinforcementScore({ lastUsedAt: NOW - 7 * DAY, useCount: 0, now: NOW })
    const twoWeeks = reinforcementScore({ lastUsedAt: NOW - 14 * DAY, useCount: 0, now: NOW })
    // 只有 recency 项(useCount 0)：今天≈0.6，一周前≈0.3，两周前≈0.15
    expect(fresh).toBeCloseTo(0.6, 5)
    expect(week).toBeCloseTo(0.3, 5)
    expect(twoWeeks).toBeCloseTo(0.15, 5)
  })

  it('increases monotonically with use frequency (holding recency)', () => {
    const at = (useCount: number) => reinforcementScore({ lastUsedAt: NOW, useCount, now: NOW })
    expect(at(0)).toBeLessThan(at(1))
    expect(at(1)).toBeLessThan(at(5))
    expect(at(5)).toBeLessThan(at(20))
  })

  it('saturates frequency so high-count memories cannot dominate unboundedly', () => {
    const at20 = reinforcementScore({ lastUsedAt: NOW, useCount: 20, now: NOW })
    const at1000 = reinforcementScore({ lastUsedAt: NOW, useCount: 1000, now: NOW })
    // 20 次已近饱和(frequency≈1)，再多提升极小
    expect(at1000 - at20).toBeLessThan(0.02)
    expect(at1000).toBeCloseTo(1, 2)
  })

  it('clamps future/skewed timestamps (now < lastUsedAt) to max recency', () => {
    const future = reinforcementScore({ lastUsedAt: NOW + 10 * DAY, useCount: 0, now: NOW })
    expect(future).toBeCloseTo(0.6, 5)
  })
})

describe('memorySalience (forgetting value)', () => {
  const base = { confidence: 0.72, lastUsedAt: NOW, useCount: 0, createdAt: NOW, now: NOW }

  it('increases with importance and with confidence', () => {
    const lowImp = memorySalience({ ...base, importance: 1 })
    const highImp = memorySalience({ ...base, importance: 5 })
    expect(highImp).toBeGreaterThan(lowImp)

    const lowConf = memorySalience({ ...base, importance: 3, confidence: 0.2 })
    const highConf = memorySalience({ ...base, importance: 3, confidence: 0.9 })
    expect(highConf).toBeGreaterThan(lowConf)
  })

  it('keeps a frequently-used low-importance memory above a stale high-importance one', () => {
    // 主流 agent 的使用驱动保留：常用低重要度 > 从不用的高重要度
    const usedLow = memorySalience({
      importance: 2, confidence: 0.72, lastUsedAt: NOW, useCount: 10, createdAt: NOW - 60 * DAY, now: NOW
    })
    const staleHigh = memorySalience({
      importance: 5, confidence: 0.72, lastUsedAt: null, useCount: 0, createdAt: NOW - 30 * DAY, now: NOW
    })
    expect(usedLow).toBeGreaterThan(staleHigh)
  })

  it('gives never-used memories a creation-recency fallback (not instantly disposable)', () => {
    const justCreated = memorySalience({
      importance: 3, confidence: 0.72, lastUsedAt: null, useCount: 0, createdAt: NOW, now: NOW
    })
    const ancientUnused = memorySalience({
      importance: 3, confidence: 0.72, lastUsedAt: null, useCount: 0, createdAt: NOW - 90 * DAY, now: NOW
    })
    // 刚创建的未使用记忆价值高于陈旧未使用的同类
    expect(justCreated).toBeGreaterThan(ancientUnused)
  })
})

describe('scoreMemory reinforcement (via rankMemoryRows)', () => {
  function row(overrides: Partial<MemoryRow>): MemoryRow {
    return {
      id: 'm', kind: 'fact', scope: 'global', title: '', content: '', summary: '',
      tags_json: '[]', workspace_path: null, project_id: null, session_id: null,
      source_message_id: null, source_type: 'manual', source_url: null, source_excerpt: '',
      confidence: 0.72, importance: 3, status: 'active', pinned: 0,
      created_at: NOW, updated_at: NOW, last_used_at: null, use_count: 0,
      expires_at: null, archived_at: null, metadata_json: '{}',
      ...overrides
    }
  }

  it('never surfaces a semantically-irrelevant memory just because it was used a lot', () => {
    const heavilyUsedButIrrelevant = row({
      id: 'irrelevant', content: '今天天气很好', last_used_at: NOW, use_count: 100
    })
    // 查询与该记忆零语义重叠 → evidence 0 → 强化不介入 → 不返回
    const ranked = rankMemoryRows([heavilyUsedButIrrelevant], '包管理器 pnpm 依赖', NOW)
    expect(ranked).toHaveLength(0)
  })

  it('ranks a recently-used relevant memory above an equally-relevant stale one', () => {
    const stale = row({ id: 'stale', content: '我用 pnpm 作为包管理器', last_used_at: NOW - 60 * DAY, use_count: 0 })
    const fresh = row({ id: 'fresh', content: '我用 pnpm 作为包管理器', last_used_at: NOW, use_count: 8 })
    const ranked = rankMemoryRows([stale, fresh], '包管理器 pnpm', NOW)
    expect(ranked.map((r) => r.id)).toEqual(['fresh', 'stale'])
  })
})
