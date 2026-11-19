import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// better-sqlite3 原生绑定按 Electron ABI 编译，node 环境测试用内置 node:sqlite 替身
// （prepare/get/run/exec/transaction 语义与 better-sqlite3 一致，含 FTS5）。
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { DatabaseService } from '../db/database.service.js'
import { memoryService } from './memory.service.js'
import type { PersonalizationSettings } from '../../shared/types/personalization.js'

function createTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  // 迁移里的一次性导入依赖 app_preferences（无 electron app 时置标记，跳过 legacy import）
  db.exec(`INSERT OR REPLACE INTO app_preferences (key, value) VALUES ('memory_legacy_imported', '1')`)
  return db as unknown as Database.Database
}

function mockDbSingleton(db: Database.Database): void {
  vi.spyOn(DatabaseService, 'getInstance').mockReturnValue({
    db,
    transaction: <T>(fn: () => T): T => fn()
  } as unknown as DatabaseService)
}

/** agent_memories.session_id 外键指向 sessions；插一条真实会话行以满足约束 */
function seedSession(db: Database.Database, id: string): void {
  const now = Date.now()
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, workspace_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, 'e2e', 'e2e', now, now)
}

/** 每个测试用例都要重置 service 内部的一次性迁移标记，否则跨用例串状态 */
function resetServiceFlags(): void {
  const internal = memoryService as unknown as {
    legacyImported: boolean
    repairedGeneratedEchoes: boolean
    normalizedActiveSlots: boolean
  }
  internal.legacyImported = false
  internal.repairedGeneratedEchoes = false
  internal.normalizedActiveSlots = false
}

const settings: PersonalizationSettings = {
  personality: 'amiable',
  memoryEnabled: true,
  memoryAutoCapture: 'balanced',
  memoryDefaultScope: 'global',
  memoryIncludeGlobal: true,
  memoryMinConfidence: 0,
  memoryPromptLimit: 8,
  memoryRetentionDays: 0,
  skipToolAssistedMemory: false,
  chroniclePreview: false
} as unknown as PersonalizationSettings

beforeEach(() => {
  mockDbSingleton(createTestDb())
  resetServiceFlags()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('memory create + retrieve (DB-level)', () => {
  it('retrieves a stored fact even when the question slot mismatches (graceful degradation)', async () => {
    await memoryService.create({ content: '我喜欢用 pnpm 作为包管理器' })

    // 提问「用什么包管理器」的槽位(project:package-manager)与事实槽位
    // (personal:包管理器:uses)不一致；严格过滤会漏掉，降级后仍能命中。
    const hits = await memoryService.retrieveForPrompt({ query: '这个项目用什么包管理器' })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some((m) => m.content.includes('pnpm'))).toBe(true)
  })

  it('dedups a paraphrase into REINFORCE instead of a second row', async () => {
    const first = await memoryService.create({ content: '我喜欢用 pnpm 作为包管理器' })
    const second = await memoryService.create({ content: '我喜欢使用 pnpm 作为包管理器' })

    // 同义改写复用已有记忆，不新增
    expect(second.id).toBe(first.id)
    expect(await memoryService.count()).toBe(1)
    // 复用即强化：importance 递增
    expect(second.importance).toBeGreaterThan(first.importance)
  })

  it('supersedes a conflicting fact in the same slot (old → archived, new → active)', async () => {
    const old = await memoryService.create({ content: '我的宠物叫小白' })
    const now = await memoryService.create({ content: '不对，现在我的宠物叫汪汪' })

    expect(now.id).not.toBe(old.id)
    // 当前检索只返回新事实
    const active = await memoryService.list({})
    expect(active.map((m) => m.content)).toContain('我的宠物叫汪汪')
    expect(active.map((m) => m.content)).not.toContain('我的宠物叫小白')

    // 历史查询能回溯旧事实
    const history = await memoryService.retrieveForPrompt({ query: '我的宠物以前叫什么' })
    expect(history.some((m) => m.content.includes('小白'))).toBe(true)
  })

  it('keeps facts in different slots side by side (no cross-topic clobber)', async () => {
    await memoryService.create({ content: '我的宠物叫小白' })
    await memoryService.create({ content: '我的编辑器用 vscode' })

    expect(await memoryService.count()).toBe(2)
  })
})

describe('memory scope isolation', () => {
  it('does not leak a workspace fact into an unrelated workspace', async () => {
    await memoryService.create({ content: '当前项目使用 pnpm', scope: 'workspace', workspacePath: '/repo/a' })

    const other = await memoryService.list({ query: '包管理器', workspacePath: '/repo/b', includeGlobal: false })
    expect(other).toHaveLength(0)

    const same = await memoryService.list({ query: '包管理器', workspacePath: '/repo/a', includeGlobal: false })
    expect(same.length).toBeGreaterThanOrEqual(1)
  })

  it('global facts are visible from any workspace', async () => {
    await memoryService.create({ content: '我喜欢用 pnpm' })
    const fromWs = await memoryService.list({ query: 'pnpm', workspacePath: '/repo/x' })
    expect(fromWs.some((m) => m.content.includes('pnpm'))).toBe(true)
  })
})

describe('memory expiry and lifecycle', () => {
  it('excludes expired memories from retrieval', async () => {
    await memoryService.create({ content: '临时事实 abcxyz', expiresAt: Date.now() - 1000 })
    const hits = await memoryService.list({ query: 'abcxyz' })
    expect(hits).toHaveLength(0)
  })

  it('archive hides from active list but delete removes entirely', async () => {
    const m = await memoryService.create({ content: '可归档的事实 foobar' })
    await memoryService.archive(m.id)
    expect((await memoryService.list({})).some((x) => x.id === m.id)).toBe(false)

    const restored = await memoryService.create({ content: '可归档的事实 foobar' })
    // 同 content_hash 复活归档记忆而非新建
    expect(restored.id).toBe(m.id)
    expect(await memoryService.count()).toBe(1)
  })
})

describe('memory reinforcement (recency + frequency)', () => {
  it('increments use_count and last_used_at on retrieval hits', async () => {
    const db = DatabaseService.getInstance().db
    const m = await memoryService.create({ content: '我用 pnpm 作为包管理器' })
    const before = db.prepare('SELECT use_count, last_used_at FROM agent_memories WHERE id = ?').get(m.id) as { use_count: number; last_used_at: number | null }
    expect(before.use_count).toBe(0)

    await memoryService.retrieveForPrompt({ query: 'pnpm 包管理器' })
    await memoryService.retrieveForPrompt({ query: 'pnpm 包管理器' })

    const after = db.prepare('SELECT use_count, last_used_at FROM agent_memories WHERE id = ?').get(m.id) as { use_count: number; last_used_at: number | null }
    expect(after.use_count).toBe(2)
    expect(after.last_used_at).not.toBeNull()
  })

  it('ranks a repeatedly-used memory above an equally-relevant never-used one', async () => {
    const db = DatabaseService.getInstance().db
    // 两条同样相关但不同槽位的记忆（避免 slot 折叠/去重把它们并成一条）
    const fresh = await memoryService.create({ content: '我喜欢用 pnpm 装依赖' })
    const stale = await memoryService.create({ content: '本项目依赖用 npm 安装', scope: 'workspace', workspacePath: '/repo/z' })

    // 模拟 fresh 被反复命中：直接抬高其 use_count 与 last_used_at
    db.prepare('UPDATE agent_memories SET use_count = 12, last_used_at = ? WHERE id = ?').run(Date.now(), fresh.id)

    const hits = await memoryService.list({ query: '依赖 安装 pnpm npm', workspacePath: '/repo/z' })
    const ids = hits.map((h) => h.id)
    expect(ids).toContain(fresh.id)
    expect(ids).toContain(stale.id)
    // 强化后的 fresh 排在 stale 之前
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(stale.id))
  })
})

describe('smart forgetting (salience-based trim)', () => {
  it('keeps a frequently-used low-importance memory over stale high-importance ones when over capacity', async () => {
    const db = DatabaseService.getInstance().db
    const now = Date.now()
    const insert = db.prepare(`
      INSERT INTO agent_memories
        (id, kind, scope, title, content, summary, source_type, confidence, importance,
         status, pinned, content_hash, created_at, updated_at, last_used_at, use_count)
      VALUES (?, 'fact', 'global', '', ?, '', 'manual', 0.72, ?, 'active', 0, ?, ?, ?, ?, ?)
    `)
    // 49 条高重要度、最近使用的填充记忆（占满容量且价值高，稳定存活）
    for (let i = 0; i < 49; i++) {
      insert.run(`filler-${i}`, `filler fact ${i}`, 5, `hash-filler-${i}`, now, now, now, 3)
    }
    // 常用低重要度（应存活）
    insert.run('used-low', 'used low importance fact', 2, 'hash-used-low', now - 60 * 86_400_000, now, now, 15)
    // 两条陈旧从不使用的高重要度（价值最低，应被淘汰）
    insert.run('stale-high-a', 'stale high importance fact a', 5, 'hash-stale-a', now - 90 * 86_400_000, now - 90 * 86_400_000, null, 0)
    insert.run('stale-high-b', 'stale high importance fact b', 5, 'hash-stale-b', now - 120 * 86_400_000, now - 120 * 86_400_000, null, 0)

    // 触发 trim：52 条 active 非置顶，超出 MAX(50) → 淘汰 2 条最低价值者
    await (memoryService as unknown as { trim: () => Promise<void> }).trim()

    const status = (id: string) =>
      (db.prepare('SELECT status FROM agent_memories WHERE id = ?').get(id) as { status: string }).status
    // 常用低重要度存活；两条陈旧高重要度被归档（使用驱动保留胜过静态重要度）
    expect(status('used-low')).toBe('active')
    expect(status('stale-high-a')).toBe('archived')
    expect(status('stale-high-b')).toBe('archived')
  })
})

describe('maybeCapture gating', () => {
  it('captures an explicit preference statement', async () => {
    seedSession(DatabaseService.getInstance().db, 's1')
    const captured = await memoryService.maybeCapture(
      { userMessage: '记住：我以后都用 bun 作为运行时', assistantMessage: '好的，已记住。', sessionId: 's1', usedTools: false },
      settings
    )
    expect(captured).not.toBeNull()
    expect(captured?.content).toContain('bun')
  })

  it('does not capture when memory is disabled', async () => {
    const captured = await memoryService.maybeCapture(
      { userMessage: '记住我喜欢 bun', assistantMessage: '好的', sessionId: 's1', usedTools: false },
      { ...settings, memoryEnabled: false }
    )
    expect(captured).toBeNull()
  })

  it('skips tool-assisted turns when configured', async () => {
    const captured = await memoryService.maybeCapture(
      { userMessage: '记住我喜欢 bun', assistantMessage: '好的', sessionId: 's1', usedTools: true },
      { ...settings, skipToolAssistedMemory: true }
    )
    expect(captured).toBeNull()
  })
})
