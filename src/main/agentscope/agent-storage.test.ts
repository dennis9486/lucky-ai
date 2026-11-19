import { describe, expect, it } from 'vitest'
// better-sqlite3 的原生绑定按 Electron ABI 编译，node 环境测试改用内置 node:sqlite
// （prepare/get/run/exec 语义一致），仅作类型层面的 Database.Database 替身。
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import type { Msg } from '@agentscope-ai/agentscope/message'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { SqliteAgentStorage, deleteAgentContext, agentStorageInternalsForTest } from './agent-storage.js'

function createTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return db as unknown as Database.Database
}

function msg(role: 'user' | 'assistant', text: string): Msg {
  return {
    id: crypto.randomUUID(),
    name: role,
    role,
    content: [{ id: crypto.randomUUID(), type: 'text', text }]
  } as unknown as Msg
}

describe('SqliteAgentStorage', () => {
  it('roundtrips context and metadata by conversation id', async () => {
    const db = createTestDb()
    const storage = new SqliteAgentStorage('conv-1', () => db)

    await storage.saveAgentState({
      context: [msg('user', '你好'), msg('assistant', '你好，有什么可以帮你？')],
      metadata: { curSummary: '寒暄', replyId: 'r1' }
    })
    const state = await storage.loadAgentState()

    expect(state.context).toHaveLength(2)
    expect(state.metadata).toMatchObject({ curSummary: '寒暄', replyId: 'r1' })

    // 会话隔离：其它会话读到空状态
    const other = await new SqliteAgentStorage('conv-2', () => db).loadAgentState()
    expect(other.context).toEqual([])
    expect(other.metadata).toEqual({})
  })

  it('overwrites previous state on save (upsert)', async () => {
    const db = createTestDb()
    const storage = new SqliteAgentStorage('conv-1', () => db)

    await storage.saveAgentState({ context: [msg('user', '第一版')], metadata: {} })
    await storage.saveAgentState({ context: [msg('user', '第二版'), msg('assistant', '好的')], metadata: {} })

    const state = await storage.loadAgentState()
    expect(state.context).toHaveLength(2)
    const rows = db.prepare('SELECT COUNT(*) AS c FROM agent_contexts').get() as { c: number }
    expect(rows.c).toBe(1)
  })

  it('falls back to empty state on corrupt persisted json', async () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO agent_contexts (conversation_id, context_json, metadata_json, updated_at) VALUES (?, ?, ?, ?)'
    ).run('conv-broken', '{not-json', 'also-broken', Date.now())

    const state = await new SqliteAgentStorage('conv-broken', () => db).loadAgentState()
    expect(state.context).toEqual([])
    expect(state.metadata).toEqual({})
  })

  it('resets when persisted context is not an array', async () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO agent_contexts (conversation_id, context_json, metadata_json, updated_at) VALUES (?, ?, ?, ?)'
    ).run('conv-object', '{"oops":true}', '{}', Date.now())

    const state = await new SqliteAgentStorage('conv-object', () => db).loadAgentState()
    expect(state.context).toEqual([])
  })

  it('deleteAgentContext removes only the target conversation', async () => {
    const db = createTestDb()
    await new SqliteAgentStorage('conv-a', () => db).saveAgentState({ context: [msg('user', 'a')], metadata: {} })
    await new SqliteAgentStorage('conv-b', () => db).saveAgentState({ context: [msg('user', 'b')], metadata: {} })

    deleteAgentContext('conv-a', () => db)

    expect((await new SqliteAgentStorage('conv-a', () => db).loadAgentState()).context).toEqual([])
    expect((await new SqliteAgentStorage('conv-b', () => db).loadAgentState()).context).toHaveLength(1)
  })
})

describe('trimContextForPersistence', () => {
  const { trimContextForPersistence } = agentStorageInternalsForTest

  it('keeps context untouched when within budget', () => {
    const context = [msg('user', 'hello'), msg('assistant', 'world')]
    expect(trimContextForPersistence(context, 1024 * 1024)).toBe(context)
  })

  it('drops oldest messages first when over budget', () => {
    const context = [msg('user', 'x'.repeat(500)), msg('user', 'y'.repeat(500)), msg('user', 'tail')]
    const budget = Buffer.byteLength(JSON.stringify(context.slice(1)), 'utf-8')
    const trimmed = trimContextForPersistence(context, budget)

    expect(trimmed.length).toBeLessThan(context.length)
    expect(trimmed.at(-1)).toBe(context.at(-1))
  })

  it('always keeps at least the newest message even if oversized', () => {
    const context = [msg('user', 'a'.repeat(2000))]
    expect(trimContextForPersistence(context, 10)).toHaveLength(1)
  })
})

describe('repairInterruptedToolCalls', () => {
  const { repairInterruptedToolCalls } = agentStorageInternalsForTest

  function assistantWithTools(blocks: Array<Record<string, unknown>>): Msg {
    return {
      id: crypto.randomUUID(),
      name: 'assistant',
      role: 'assistant',
      content: blocks.map((block) => ({ id: crypto.randomUUID(), ...block }))
    } as unknown as Msg
  }

  it('synthesizes interrupted results for dangling tool calls on load', async () => {
    const db = createTestDb()
    // 模拟中断轮次落库：assistant 消息带两个 tool_call，仅一个有结果
    const context = [
      msg('user', '收集支付资料'),
      assistantWithTools([
        { type: 'tool_call', id: 'call-1', name: 'WebSearch', input: '{}', state: 'submitted' },
        { type: 'tool_result', id: 'call-1', name: 'WebSearch', output: 'ok', state: 'success' },
        { type: 'tool_call', id: 'call-2', name: 'WebSearch', input: '{}', state: 'submitted' }
      ])
    ]
    await new SqliteAgentStorage('conv-int', () => db).saveAgentState({ context, metadata: {} })

    const restored = await new SqliteAgentStorage('conv-int', () => db).loadAgentState()
    const blocks = restored.context[1]!.content as Array<{ type: string; id: string; state?: string; output?: unknown }>
    const results = blocks.filter((block) => block.type === 'tool_result')

    // call-2 补上了 interrupted 结果；call-1 原有结果不受影响
    expect(results.map((block) => block.id).sort()).toEqual(['call-1', 'call-2'])
    const synthetic = results.find((block) => block.id === 'call-2')
    expect(synthetic?.state).toBe('interrupted')
    expect(JSON.stringify(synthetic?.output)).toContain('interrupted before completion')
    // 悬空调用被标记完成，恢复后不再触发「等待确认」误判
    expect(blocks.find((block) => block.type === 'tool_call' && block.id === 'call-2')?.state).toBe('finished')
  })

  it('leaves complete contexts untouched', () => {
    const context = [
      msg('user', 'q'),
      assistantWithTools([
        { type: 'tool_call', id: 'c1', name: 'Read', input: '{}', state: 'finished' },
        { type: 'tool_result', id: 'c1', name: 'Read', output: 'data', state: 'success' }
      ])
    ]
    const before = JSON.stringify(context)
    repairInterruptedToolCalls(context, 'conv-x')
    expect(JSON.stringify(context)).toBe(before)
  })
})
