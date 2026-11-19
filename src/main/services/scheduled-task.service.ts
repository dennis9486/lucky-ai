import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DatabaseService } from '../db/database.service.js'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskCadence,
  ScheduledTaskListOptions,
  ScheduledTaskRun,
  ScheduledTaskRunStatus,
  ScheduledTaskRunTrigger,
  ScheduledTaskTemplate,
  UpdateScheduledTaskInput
} from '../../shared/types/scheduled-task.js'
import { computeNextRunAt } from './scheduled-task-schedule.js'
import { createLogger } from '../../shared/utils/log.js'

const ONCE_DEFAULT_DELAY = 60 * 60 * 1000
/** 每个任务保留的运行历史条数上限。 */
const MAX_RUNS_PER_TASK = 50
/** 失败自动重试上限（超过后清 pending、保留 error 状态与 note） */
const MAX_TASK_RETRIES = 3
/** 重试退避基数：5min → 10min → 20min */
const RETRY_BACKOFF_BASE_MS = 5 * 60_000
const logger = createLogger('main/scheduled-task-service')

export const TASK_TEMPLATES: ScheduledTaskTemplate[] = [
  {
    id: 'daily-briefing',
    title: '工作日晨间简报',
    description: '汇总日历安排、未读事项和当天需要注意的重点。',
    icon: 'bell',
    category: 'system',
    cadence: 'workdays',
    scheduleText: '工作日 8:00',
    prompt: 'Prepare a concise weekday morning briefing: calendar schedule, important unread updates, and anything that needs attention today.'
  },
  {
    id: 'weekly-review',
    title: '每周回顾',
    description: '每周总结重点进展、遗留问题和下周建议。',
    icon: 'book',
    category: 'system',
    cadence: 'weekly',
    scheduleText: '周五 9:00',
    prompt: 'Create a weekly review with accomplishments, unresolved risks, and practical next steps for the coming week.'
  },
  {
    id: 'project-monitor',
    title: '项目监控',
    description: '定期检查项目风险、待办和近期变更。',
    icon: 'search',
    category: 'project',
    cadence: 'daily',
    scheduleText: '每天 9:00',
    prompt: 'Monitor the current project for recent changes, open risks, failing checks, and actionable follow-ups.'
  },
  {
    id: 'recent-commit-bug-scan',
    title: '扫描最近提交',
    description: '检查最近 24 小时或上次运行后的 commit，找出潜在 bug。',
    icon: 'bug',
    category: 'project',
    cadence: 'daily',
    scheduleText: '每天 9:00',
    prompt: 'Scan recent commits since the last run or the past 24 hours. Identify possible bugs using concrete repository evidence only.'
  },
  {
    id: 'pr-release-notes',
    title: 'PR 发布说明',
    description: '根据已合并 PR 起草每周发布说明。',
    icon: 'git',
    category: 'project',
    cadence: 'weekly',
    scheduleText: '周五 10:00',
    prompt: 'Draft weekly release notes from merged pull requests. Use only repository evidence and include links when available.'
  },
  {
    id: 'ci-failure-review',
    title: 'CI 失败分析',
    description: '分析最近 CI 失败和不稳定测试，给出首要修复建议。',
    icon: 'sparkles',
    category: 'system',
    cadence: 'daily',
    scheduleText: '每天 21:00',
    prompt: 'Review recent CI failures and flaky tests. Summarize likely causes and the smallest useful fixes with supporting logs.'
  }
]

interface ScheduledTaskRow {
  id: string
  title: string
  prompt: string
  project_id: string | null
  project_name: string | null
  timezone: string
  cadence: ScheduledTaskCadence
  schedule_text: string
  run_mode: ScheduledTask['runMode']
  next_run_at: number | null
  last_run_at: number | null
  pending_run_at: number | null
  remind_at: number | null
  last_run_status: ScheduledTask['lastRunStatus']
  status: ScheduledTask['status']
  source: ScheduledTask['source']
  source_session_id: string | null
  metadata_json: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** 计算下一次运行时间；once 无明确首跑时间时默认 1 小时后。 */
function nextRunFor(
  cadence: ScheduledTaskCadence,
  scheduleText: string,
  from: number,
  timezone: string
): number | null {
  return computeNextRunAt(cadence, scheduleText, from, timezone) ?? (cadence === 'once' ? from + ONCE_DEFAULT_DELAY : null)
}

export class ScheduledTaskService {
  /** 测试可注入 :memory: 库；默认应用级单例 */
  constructor(private readonly resolveDb: () => Database.Database = () => DatabaseService.getInstance().db) {}

  private get db() {
    return this.resolveDb()
  }

  list(options: ScheduledTaskListOptions = {}): ScheduledTask[] {
    const params: unknown[] = []
    const where: string[] = []
    if (options.status && options.status !== 'all') {
      where.push('status = ?')
      params.push(options.status)
    } else if (!options.status) {
      where.push("status != 'archived'")
    }
    const query = options.query?.trim()
    if (query) {
      where.push('(title LIKE ? OR prompt LIKE ? OR project_name LIKE ?)')
      const like = `%${query}%`
      params.push(like, like, like)
    }
    const sql = `
      SELECT * FROM scheduled_tasks
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
        pending_run_at IS NULL,
        next_run_at IS NULL,
        next_run_at ASC,
        updated_at DESC
    `
    return this.db.prepare(sql).all(...params).map((row) => mapTask(row as ScheduledTaskRow))
  }

  listTemplates(query = ''): ScheduledTaskTemplate[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return TASK_TEMPLATES
    return TASK_TEMPLATES.filter(
      (template) => `${template.title} ${template.description} ${template.prompt}`.toLowerCase().includes(normalized)
    )
  }

  get(id: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow | undefined
    return row ? mapTask(row) : null
  }

  /** 已激活、到点（next_run_at <= now）的任务，供调度器消费。 */
  listDue(now: number = Date.now()): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at ASC`
      )
      .all(now) as ScheduledTaskRow[]
    return rows.map(mapTask)
  }

  create(input: CreateScheduledTaskInput): ScheduledTask {
    const title = input.title.trim()
    const prompt = input.prompt.trim()
    if (!title) throw new Error('任务标题不能为空')
    if (!prompt) throw new Error('任务内容不能为空')
    const now = Date.now()
    const cadence = input.cadence ?? 'custom'
    const scheduleText = input.scheduleText?.trim() ?? ''
    const timezone = input.timezone?.trim() || getLocalTimezone()
    const nextRunAt = input.nextRunAt ?? nextRunFor(cadence, scheduleText, now, timezone)
    const task: ScheduledTask = {
      id: randomUUID(),
      title,
      prompt,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      timezone,
      cadence,
      scheduleText,
      runMode: input.runMode ?? 'notify',
      nextRunAt,
      lastRunAt: null,
      pendingRunAt: null,
      remindAt: input.remindAt ?? null,
      lastRunStatus: null,
      status: 'active',
      source: input.source ?? 'manual',
      sourceSessionId: input.sourceSessionId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
    this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, title, prompt, project_id, project_name, timezone, cadence, schedule_text,
        run_mode, next_run_at, last_run_at, pending_run_at, remind_at, last_run_status,
        status, source, source_session_id, metadata_json,
        created_at, updated_at, archived_at
      ) VALUES (
        @id, @title, @prompt, @projectId, @projectName, @timezone, @cadence, @scheduleText,
        @runMode, @nextRunAt, @lastRunAt, @pendingRunAt, @remindAt, @lastRunStatus,
        @status, @source, @sourceSessionId, @metadataJson,
        @createdAt, @updatedAt, @archivedAt
      )
    `).run(toDbParams(task))
    logger.info('task created', {
      id: task.id,
      title: task.title,
      cadence: task.cadence,
      runMode: task.runMode,
      nextRunAt: task.nextRunAt,
      source: task.source
    })
    return task
  }

  createFromTemplate(templateId: string, overrides: Partial<CreateScheduledTaskInput> = {}): ScheduledTask {
    const template = TASK_TEMPLATES.find((item) => item.id === templateId)
    if (!template) throw new Error(`未知任务模板: ${templateId}`)
    return this.create({
      title: overrides.title ?? template.title,
      prompt: overrides.prompt ?? template.prompt,
      cadence: overrides.cadence ?? template.cadence,
      scheduleText: overrides.scheduleText ?? template.scheduleText,
      projectId: overrides.projectId,
      projectName: overrides.projectName,
      timezone: overrides.timezone,
      runMode: overrides.runMode,
      nextRunAt: overrides.nextRunAt,
      source: overrides.source ?? 'template',
      sourceSessionId: overrides.sourceSessionId,
      metadata: { templateId, ...(overrides.metadata ?? {}) }
    })
  }

  update(input: UpdateScheduledTaskInput): ScheduledTask | null {
    const current = this.get(input.id)
    if (!current) return null
    const now = Date.now()
    const next: ScheduledTask = {
      ...current,
      ...stripUndefined(input),
      title: input.title?.trim() ?? current.title,
      prompt: input.prompt?.trim() ?? current.prompt,
      scheduleText: input.scheduleText?.trim() ?? current.scheduleText,
      timezone: input.timezone?.trim() || current.timezone,
      updatedAt: now,
      archivedAt: input.status === 'archived' ? now : input.status === 'active' ? null : current.archivedAt
    }
    if (!next.title) throw new Error('任务标题不能为空')
    if (!next.prompt) throw new Error('任务内容不能为空')

    // 排期相关字段变化时（时区 / 时间文本 / 周期 / 重新激活），且调用方未显式指定 nextRunAt，
    // 则按新时区/规则重算下一次运行时间，避免编辑后排期与显示不一致。
    const scheduleChanged =
      input.nextRunAt === undefined &&
      next.status === 'active' &&
      (input.cadence !== undefined || input.scheduleText !== undefined || input.timezone !== undefined || input.status === 'active')
    if (scheduleChanged) {
      next.nextRunAt = nextRunFor(next.cadence, next.scheduleText, now, next.timezone)
    }

    this.db.prepare(`
      UPDATE scheduled_tasks SET
        title = @title,
        prompt = @prompt,
        project_id = @projectId,
        project_name = @projectName,
        timezone = @timezone,
        cadence = @cadence,
        schedule_text = @scheduleText,
        run_mode = @runMode,
        next_run_at = @nextRunAt,
        last_run_at = @lastRunAt,
        pending_run_at = @pendingRunAt,
        remind_at = @remindAt,
        last_run_status = @lastRunStatus,
        status = @status,
        source_session_id = @sourceSessionId,
        metadata_json = @metadataJson,
        updated_at = @updatedAt,
        archived_at = @archivedAt
      WHERE id = @id
    `).run(toDbParams(next))
    logger.info('task updated', {
      id: next.id,
      status: next.status,
      cadence: next.cadence,
      runMode: next.runMode,
      nextRunAt: next.nextRunAt,
      pendingRunAt: next.pendingRunAt,
      remindAt: next.remindAt
    })
    return next
  }

  archive(id: string): ScheduledTask | null {
    return this.update({ id, status: 'archived' })
  }

  /**
   * 调度器在到点时调用：滚动 next_run_at 到下一次，并把本次到期时间记为 pending（待消费）。
   * once 周期触发后转为 paused 且无后续运行。返回更新后的任务。
   */
  markFired(id: string, now: number = Date.now()): ScheduledTask | null {
    const current = this.get(id)
    if (!current || current.status !== 'active') return null
    const scheduledFor = current.nextRunAt ?? now
    const base = Math.max(now, scheduledFor)
    const nextRunAt = current.cadence === 'once' ? null : nextRunFor(current.cadence, current.scheduleText, base, current.timezone)
    const status: ScheduledTask['status'] = current.cadence === 'once' ? 'paused' : 'active'
    this.db
      .prepare(
        `UPDATE scheduled_tasks SET next_run_at = @nextRunAt, pending_run_at = @pendingRunAt, remind_at = NULL,
         status = @status, updated_at = @now WHERE id = @id`
      )
      .run({ id, nextRunAt, pendingRunAt: scheduledFor, status, now })
    logger.info('task fired', { id, scheduledFor, nextRunAt, status })
    return this.get(id)
  }

  /**
   * 记录一次运行结果：写入 last_run_at/last_run_status。不改变排期。
   * 失败重试闭环：status='error' 时保留 pending 并按指数退避设置 remind_at
   * （5min → 10min → 20min，最多 MAX_TASK_RETRIES 次），由调度器到点重新点火；
   * 重试耗尽或运行成功时清除 pending 并复位重试计数。
   */
  markRun(
    id: string,
    status: ScheduledTaskRunStatus = 'ok',
    trigger: ScheduledTaskRunTrigger = 'manual',
    note = '',
    now: number = Date.now()
  ): ScheduledTask | null {
    const current = this.get(id)
    if (!current) return null

    const previousRetries = Number(current.metadata?.retryCount ?? 0) || 0
    const willRetry = status === 'error' && previousRetries < MAX_TASK_RETRIES
    const nextMetadata = { ...current.metadata, retryCount: willRetry ? previousRetries + 1 : 0 }
    const retryRemindAt = willRetry ? now + RETRY_BACKOFF_BASE_MS * 2 ** previousRetries : null
    const pendingRunAt = willRetry ? (current.pendingRunAt ?? now) : null

    withTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE scheduled_tasks SET last_run_at = @now, last_run_status = @status,
           pending_run_at = @pendingRunAt, remind_at = @retryRemindAt, metadata_json = @metadataJson,
           updated_at = @now WHERE id = @id`
        )
        .run({ id, now, status, pendingRunAt, retryRemindAt, metadataJson: JSON.stringify(nextMetadata) })
      this.db
        .prepare(
          `INSERT INTO scheduled_task_runs (id, task_id, status, trigger, note, created_at)
           VALUES (@runId, @id, @status, @trigger, @note, @now)`
        )
        .run({ runId: randomUUID(), id, status, trigger, note: note.slice(0, 2000), now })
      // 每个任务只保留最近 MAX_RUNS_PER_TASK 条历史
      this.db
        .prepare(
          `DELETE FROM scheduled_task_runs WHERE task_id = @id AND id NOT IN (
             SELECT id FROM scheduled_task_runs WHERE task_id = @id ORDER BY created_at DESC LIMIT @keep
           )`
        )
        .run({ id, keep: MAX_RUNS_PER_TASK })
    })
    logger.info('task run marked', {
      id,
      status,
      trigger,
      hasNote: Boolean(note),
      ...(willRetry ? { retryAttempt: previousRetries + 1, retryRemindAt } : {}),
      ...(status === 'error' && !willRetry && previousRetries >= MAX_TASK_RETRIES ? { retriesExhausted: true } : {})
    })
    return this.get(id)
  }

  /**
   * 到点的「待办提醒/失败重试」：pending 且 remind_at 已到的任务，供调度器重新点火。
   * 点火方需随后调用 consumeRemind 清除 remind_at，避免每个 tick 重复触发。
   */
  listRemindDue(now: number = Date.now()): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE status = 'active' AND pending_run_at IS NOT NULL
           AND remind_at IS NOT NULL AND remind_at <= ?
         ORDER BY remind_at ASC`
      )
      .all(now) as ScheduledTaskRow[]
    return rows.map(mapTask)
  }

  /** 消费一次提醒（清 remind_at，保留 pending） */
  consumeRemind(id: string): void {
    this.db
      .prepare('UPDATE scheduled_tasks SET remind_at = NULL, updated_at = @now WHERE id = @id')
      .run({ id, now: Date.now() })
  }

  /** 某任务的运行历史（最近在前）。 */
  listRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_id, status, trigger, note, created_at
         FROM scheduled_task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(taskId, Math.min(Math.max(limit, 1), 100)) as Array<{
        id: string; task_id: string; status: ScheduledTaskRunStatus
        trigger: ScheduledTaskRunTrigger; note: string; created_at: number
      }>
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      status: row.status,
      trigger: row.trigger,
      note: row.note,
      createdAt: row.created_at
    }))
  }

  /** 用户忽略一个“到期待运行”而不实际运行：仅清除 pending。 */
  dismissPending(id: string): ScheduledTask | null {
    const current = this.get(id)
    if (!current) return null
    const now = Date.now()
    this.db
      .prepare('UPDATE scheduled_tasks SET pending_run_at = NULL, remind_at = NULL, updated_at = @now WHERE id = @id')
      .run({ id, now })
    return this.get(id)
  }

  /** 手动“立即运行”：等价于记录一次运行（不消费排期、不改变暂停状态）。 */
  runNow(id: string): ScheduledTask | null {
    const current = this.get(id)
    if (!current || current.status === 'archived') return current
    return this.markRun(id, 'ok')
  }
}

/** 事务包装：better-sqlite3 用原生 transaction；node:sqlite（测试）回退 BEGIN/COMMIT */
function withTransaction(db: Database.Database, fn: () => void): void {
  const tx = (db as { transaction?: (fn: () => void) => () => void }).transaction
  if (typeof tx === 'function') {
    tx.call(db, fn)()
    return
  }
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const scheduledTaskService = new ScheduledTaskService()

function mapTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    projectId: row.project_id,
    projectName: row.project_name,
    timezone: row.timezone,
    cadence: row.cadence,
    scheduleText: row.schedule_text,
    runMode: row.run_mode ?? 'notify',
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    pendingRunAt: row.pending_run_at ?? null,
    remindAt: row.remind_at ?? null,
    lastRunStatus: row.last_run_status ?? null,
    status: row.status,
    source: row.source,
    sourceSessionId: row.source_session_id,
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  }
}

function toDbParams(task: ScheduledTask) {
  return {
    ...task,
    metadataJson: JSON.stringify(task.metadata ?? {})
  }
}

function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
