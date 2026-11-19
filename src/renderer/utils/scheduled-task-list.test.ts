import { describe, expect, it } from 'vitest'
import { compareScheduledTasks, matchesScheduledTaskQuery, upsertScheduledTask } from './scheduled-task-list.js'
import type { ScheduledTask } from '../../shared/types/scheduled-task.js'

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'id',
    title: 'Task',
    prompt: 'do something',
    projectId: null,
    projectName: null,
    timezone: 'UTC',
    cadence: 'daily',
    scheduleText: '',
    runMode: 'notify',
    nextRunAt: 1000,
    lastRunAt: null,
    pendingRunAt: null,
    remindAt: null,
    lastRunStatus: null,
    status: 'active',
    source: 'manual',
    sourceSessionId: null,
    metadata: {},
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    ...over
  }
}

describe('compareScheduledTasks', () => {
  it('orders active < paused < archived', () => {
    const list = [task({ id: 'c', status: 'archived' }), task({ id: 'b', status: 'paused' }), task({ id: 'a', status: 'active' })]
    expect(list.sort(compareScheduledTasks).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts pending tasks first within the same status', () => {
    const list = [task({ id: 'n', pendingRunAt: null }), task({ id: 'p', pendingRunAt: 500 })]
    expect(list.sort(compareScheduledTasks).map((t) => t.id)).toEqual(['p', 'n'])
  })

  it('orders by next_run_at asc, nulls last, then updated_at desc', () => {
    const list = [
      task({ id: 'null', nextRunAt: null, updatedAt: 5 }),
      task({ id: 'late', nextRunAt: 3000 }),
      task({ id: 'early', nextRunAt: 1000 })
    ]
    expect(list.sort(compareScheduledTasks).map((t) => t.id)).toEqual(['early', 'late', 'null'])
  })
})

describe('matchesScheduledTaskQuery', () => {
  it('matches title / prompt / projectName case-insensitively', () => {
    const t = task({ title: 'Deploy', prompt: 'run CI', projectName: 'WebApp' })
    expect(matchesScheduledTaskQuery(t, '')).toBe(true)
    expect(matchesScheduledTaskQuery(t, 'deploy')).toBe(true)
    expect(matchesScheduledTaskQuery(t, 'ci')).toBe(true)
    expect(matchesScheduledTaskQuery(t, 'webapp')).toBe(true)
    expect(matchesScheduledTaskQuery(t, 'nope')).toBe(false)
  })
})

describe('upsertScheduledTask', () => {
  it('replaces an existing task by id and keeps order', () => {
    const list = [task({ id: 'a', nextRunAt: 1000 }), task({ id: 'b', nextRunAt: 3000 })]
    const updated = task({ id: 'b', nextRunAt: 500 }) // now earliest
    const next = upsertScheduledTask(list, updated, '')
    expect(next.map((t) => t.id)).toEqual(['b', 'a'])
    expect(next.find((t) => t.id === 'b')!.nextRunAt).toBe(500)
  })

  it('inserts a new task in sorted position', () => {
    const list = [task({ id: 'a', nextRunAt: 2000 })]
    const next = upsertScheduledTask(list, task({ id: 'b', nextRunAt: 1000 }), '')
    expect(next.map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('removes a task that no longer matches the active query', () => {
    // 列表在启用搜索时只含命中项；把其中一项改名到不再命中 → 应从列表移除
    const list = [task({ id: 'a', title: 'target one' }), task({ id: 'b', title: 'target two' })]
    const next = upsertScheduledTask(list, task({ id: 'b', title: 'renamed' }), 'target')
    expect(next.map((t) => t.id)).toEqual(['a'])
  })

  it('does not mutate the input array', () => {
    const list = [task({ id: 'a' })]
    const next = upsertScheduledTask(list, task({ id: 'b' }), '')
    expect(list).toHaveLength(1)
    expect(next).toHaveLength(2)
  })
})
