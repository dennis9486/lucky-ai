import { afterEach, describe, expect, it, vi } from 'vitest'
// better-sqlite3 原生绑定按 Electron ABI 编译，node 环境测试用内置 node:sqlite 替身
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { DatabaseService } from '../db/database.service.js'
import { conversationService } from './conversation.service.js'
import type { ChatMessage } from '../../shared/types/ai.js'

function createTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return db as unknown as Database.Database
}

function mockDbSingleton(db: Database.Database): void {
  vi.spyOn(DatabaseService, 'getInstance').mockReturnValue({
    db,
    // node:sqlite 无 better-sqlite3 的 transaction 包装，测试里直接执行
    transaction: <T>(fn: () => T): T => fn()
  } as unknown as DatabaseService)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recoverInterruptedStreaming', () => {
  it('finalizes streaming messages and settles tool parts stuck in running state', () => {
    const db = createTestDb()
    mockDbSingleton(db)

    conversationService.createSession({ id: 's-crash', title: '崩溃恢复', workspaceName: 'e2e' })
    const streamingMessage: ChatMessage = {
      id: 'm-streaming',
      role: 'assistant',
      content: '正在搜索…',
      timestamp: Date.now(),
      meta: { streaming: true },
      parts: [
        { type: 'text', text: '正在搜索…' },
        { type: 'tool', id: 'call-1', name: 'WebSearch', output: '', status: 'running' },
        { type: 'tool', id: 'call-2', name: 'WebSearch', output: '部分输出', status: 'pending' },
        { type: 'tool', id: 'call-3', name: 'Read', output: 'done', status: 'success' }
      ]
    }
    conversationService.appendMessage('s-crash', streamingMessage)

    const recovered = conversationService.recoverInterruptedStreaming('s-crash')
    const message = recovered.find((item) => item.id === 'm-streaming')

    expect(message?.meta).toMatchObject({ streaming: false, incomplete: true })
    const tools = (message?.parts ?? []).filter((part) => part.type === 'tool')
    // running/pending 收敛为 error 并注明中断；已完成的不受影响
    expect(tools.find((part) => part.id === 'call-1')).toMatchObject({ status: 'error' })
    expect(tools.find((part) => part.id === 'call-2')).toMatchObject({ status: 'error' })
    expect(String(tools.find((part) => part.id === 'call-2')?.output)).toContain('已中断')
    expect(tools.find((part) => part.id === 'call-3')).toMatchObject({ status: 'success', output: 'done' })

    // 修复已落库：二次读取（无恢复逻辑介入）也是收敛后的状态
    const detail = conversationService.getSessionDetail('s-crash')
    const persisted = detail?.messages.find((item) => item.id === 'm-streaming')
    expect(persisted?.parts?.filter((part) => part.type === 'tool' && part.status === 'running')).toHaveLength(0)
  })

  it('leaves completed messages untouched', () => {
    const db = createTestDb()
    mockDbSingleton(db)

    conversationService.createSession({ id: 's-ok', title: '正常会话', workspaceName: 'e2e' })
    conversationService.appendMessage('s-ok', {
      id: 'm-done',
      role: 'assistant',
      content: '完成',
      timestamp: Date.now(),
      parts: [{ type: 'tool', id: 'c', name: 'Read', output: 'ok', status: 'success' }]
    })

    const recovered = conversationService.recoverInterruptedStreaming('s-ok')
    expect(recovered.find((item) => item.id === 'm-done')?.parts?.[0]).toMatchObject({ status: 'success' })
  })
})
