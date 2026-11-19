import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { ScheduledTaskService } from './scheduled-task.service.js'

function createService(): ScheduledTaskService {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  // node:sqlite 默认拒绝多余命名参数（better-sqlite3 忽略之），对齐生产语义
  const adapted = {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql) as unknown as { setAllowUnknownNamedParameters?: (v: boolean) => void }
      stmt.setAllowUnknownNamedParameters?.(true)
      return stmt
    }
  }
  return new ScheduledTaskService(() => adapted as unknown as Database.Database)
}

describe('scheduled task failure retry loop', () => {
  it('schedules exponential-backoff retries and keeps pending until exhausted', () => {
    const service = createService()
    const task = service.create({ title: '巡检', prompt: '检查服务状态', cadence: 'daily' })
    const t0 = 1_000_000_000

    // 点火 → pending
    service.markFired(task.id, t0)

    // 第 1 次失败：retryCount=1，remind = +5min，pending 保留
    let updated = service.markRun(task.id, 'error', 'auto', 'boom', t0)!
    expect(updated.metadata?.retryCount).toBe(1)
    expect(updated.pendingRunAt).not.toBeNull()
    expect(updated.remindAt).toBe(t0 + 5 * 60_000)

    // 第 2 次失败：retryCount=2，remind = +10min
    updated = service.markRun(task.id, 'error', 'auto', 'boom', t0 + 5 * 60_000)!
    expect(updated.metadata?.retryCount).toBe(2)
    expect(updated.remindAt).toBe(t0 + 5 * 60_000 + 10 * 60_000)

    // 第 3 次失败：retryCount=3，remind = +20min
    updated = service.markRun(task.id, 'error', 'auto', 'boom', t0 + 15 * 60_000)!
    expect(updated.metadata?.retryCount).toBe(3)

    // 第 4 次失败：重试耗尽 → pending 清除、计数复位、状态保留 error
    updated = service.markRun(task.id, 'error', 'auto', 'boom', t0 + 35 * 60_000)!
    expect(updated.metadata?.retryCount).toBe(0)
    expect(updated.pendingRunAt).toBeNull()
    expect(updated.remindAt).toBeNull()
    expect(updated.lastRunStatus).toBe('error')
  })

  it('a successful run resets the retry counter and clears pending', () => {
    const service = createService()
    const task = service.create({ title: 't', prompt: 'p', cadence: 'daily' })
    const t0 = 2_000_000_000

    service.markFired(task.id, t0)
    service.markRun(task.id, 'error', 'auto', 'boom', t0)
    const ok = service.markRun(task.id, 'ok', 'auto', '', t0 + 60_000)!

    expect(ok.metadata?.retryCount).toBe(0)
    expect(ok.pendingRunAt).toBeNull()
    expect(ok.remindAt).toBeNull()
    expect(ok.lastRunStatus).toBe('ok')
  })

  it('listRemindDue surfaces due retries and consumeRemind is one-shot', () => {
    const service = createService()
    const task = service.create({ title: 't', prompt: 'p', cadence: 'daily' })
    const t0 = 3_000_000_000

    service.markFired(task.id, t0)
    service.markRun(task.id, 'error', 'auto', 'boom', t0)

    // 未到点：不出现
    expect(service.listRemindDue(t0 + 60_000)).toHaveLength(0)
    // 到点：出现
    const due = service.listRemindDue(t0 + 5 * 60_000)
    expect(due.map((item) => item.id)).toEqual([task.id])

    // 消费后不再重复触发（pending 保留，等下一次 markRun 重排）
    service.consumeRemind(task.id)
    expect(service.listRemindDue(t0 + 10 * 60_000)).toHaveLength(0)
    expect(service.get(task.id)?.pendingRunAt).not.toBeNull()
  })
})
