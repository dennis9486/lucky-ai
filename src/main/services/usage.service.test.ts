import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { UsageService } from './usage.service.js'

function createTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return db as unknown as Database.Database
}

describe('UsageService', () => {
  it('records calls and aggregates totals, days and models', () => {
    const db = createTestDb()
    const service = new UsageService(() => db)

    service.record({ conversationId: 'c1', sessionId: 's1', provider: 'Ollama', model: 'qwen3', inputTokens: 100, outputTokens: 50 })
    service.record({ conversationId: 'c1', sessionId: 's2', provider: 'Ollama', model: 'qwen3', inputTokens: 200, outputTokens: 80 })
    service.record({ conversationId: 'c2', sessionId: 's3', provider: 'Anthropic', model: 'claude', inputTokens: 300, outputTokens: 120 })

    const summary = service.getSummary(7)

    expect(summary.totalInputTokens).toBe(600)
    expect(summary.totalOutputTokens).toBe(250)
    expect(summary.totalCalls).toBe(3)

    // 逐日补 0：7 天序列，今天有 3 次调用
    expect(summary.days).toHaveLength(7)
    expect(summary.days.at(-1)?.calls).toBe(3)
    expect(summary.days[0]?.calls).toBe(0)

    // 按模型聚合，调用量降序
    expect(summary.models).toEqual([
      { provider: 'Ollama', model: 'qwen3', inputTokens: 300, outputTokens: 130, calls: 2 },
      { provider: 'Anthropic', model: 'claude', inputTokens: 300, outputTokens: 120, calls: 1 }
    ])
  })

  it('sanitizes invalid token counts and never throws on record', () => {
    const db = createTestDb()
    const service = new UsageService(() => db)

    service.record({ inputTokens: -5, outputTokens: Number.NaN })
    const summary = service.getSummary(1)
    expect(summary.totalInputTokens).toBe(0)
    expect(summary.totalOutputTokens).toBe(0)
    expect(summary.totalCalls).toBe(1)

    // resolveDb 抛错时 record 静默不抛
    const broken = new UsageService(() => {
      throw new Error('db gone')
    })
    expect(() => broken.record({ inputTokens: 1, outputTokens: 1 })).not.toThrow()
  })

  it('clamps the days window', () => {
    const db = createTestDb()
    const service = new UsageService(() => db)
    expect(service.getSummary(0).days).toHaveLength(1)
    expect(service.getSummary(9999).days).toHaveLength(365)
  })
})
