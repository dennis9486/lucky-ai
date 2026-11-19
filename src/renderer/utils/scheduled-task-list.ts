import type { ScheduledTask } from '../../shared/types/scheduled-task.js'

/**
 * 已安排任务列表的本地维护工具（纯函数、可单测）。
 *
 * 用于「乐观本地更新」：CRUD/markRun 等 IPC 已返回更新后的任务对象，无需再全量重取列表。
 * 排序与过滤规则需与后端 `scheduledTaskService.list()` 的 SQL 保持一致：
 *   ORDER BY status(active<paused<archived), pending_run_at IS NULL, next_run_at IS NULL, next_run_at ASC, updated_at DESC
 *   WHERE (title LIKE q OR prompt LIKE q OR project_name LIKE q)
 */

function statusRank(status: ScheduledTask['status']): number {
  return status === 'active' ? 0 : status === 'paused' ? 1 : 2
}

/** 与后端 list() 的 ORDER BY 一致的比较器。 */
export function compareScheduledTasks(a: ScheduledTask, b: ScheduledTask): number {
  const rank = statusRank(a.status) - statusRank(b.status)
  if (rank !== 0) return rank

  // pending_run_at IS NULL：有 pending（非空）排在前
  const aPending = a.pendingRunAt == null ? 1 : 0
  const bPending = b.pendingRunAt == null ? 1 : 0
  if (aPending !== bPending) return aPending - bPending

  // next_run_at IS NULL：有下次运行时间的排在前
  const aNextNull = a.nextRunAt == null ? 1 : 0
  const bNextNull = b.nextRunAt == null ? 1 : 0
  if (aNextNull !== bNextNull) return aNextNull - bNextNull

  // next_run_at ASC
  if (a.nextRunAt != null && b.nextRunAt != null && a.nextRunAt !== b.nextRunAt) {
    return a.nextRunAt - b.nextRunAt
  }

  // updated_at DESC
  return b.updatedAt - a.updatedAt
}

/** 与后端 LIKE 过滤一致（title / prompt / project_name 任一命中，大小写不敏感）。 */
export function matchesScheduledTaskQuery(task: ScheduledTask, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [task.title, task.prompt, task.projectName ?? ''].some((field) => field.toLowerCase().includes(q))
}

/**
 * 将一个更新/新建后的任务合并进列表并保持有序：
 * - 命中当前搜索词 → 替换或插入后重排；
 * - 不命中 → 从列表移除（等价于全量重取时它不再出现）。
 */
export function upsertScheduledTask(list: ScheduledTask[], task: ScheduledTask, query = ''): ScheduledTask[] {
  const without = list.filter((item) => item.id !== task.id)
  const next = matchesScheduledTaskQuery(task, query) ? [...without, task] : without
  return next.sort(compareScheduledTasks)
}
