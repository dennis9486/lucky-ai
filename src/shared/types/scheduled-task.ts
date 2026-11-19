export type ScheduledTaskCadence = 'once' | 'daily' | 'weekly' | 'workdays' | 'monthly' | 'custom'

export type ScheduledTaskStatus = 'active' | 'paused' | 'archived'

export type ScheduledTaskSource = 'chat' | 'template' | 'manual' | 'system'

export type ScheduledTaskTemplateCategory = 'system' | 'project'

/** 到点行为：notify=提醒用户一键运行；auto=渲染进程到点自动运行 */
export type ScheduledTaskRunMode = 'notify' | 'auto'

/** 最近一次运行结果，用于运行历史与诊断 */
export type ScheduledTaskRunStatus = 'ok' | 'error' | 'skipped'

export interface ScheduledTask {
  id: string
  title: string
  prompt: string
  projectId: string | null
  projectName: string | null
  timezone: string
  cadence: ScheduledTaskCadence
  scheduleText: string
  runMode: ScheduledTaskRunMode
  nextRunAt: number | null
  lastRunAt: number | null
  /** 已到点但尚未被消费的计划时间；非空表示该任务“到期待运行” */
  pendingRunAt: number | null
  /** pending 任务下一次在 Chat 中提醒的时间；为空表示立即提醒 */
  remindAt: number | null
  lastRunStatus: ScheduledTaskRunStatus | null
  status: ScheduledTaskStatus
  source: ScheduledTaskSource
  sourceSessionId: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ScheduledTaskTemplate {
  id: string
  title: string
  description: string
  icon: string
  category: ScheduledTaskTemplateCategory
  cadence: ScheduledTaskCadence
  scheduleText: string
  prompt: string
}

export interface ScheduledTaskListOptions {
  status?: ScheduledTaskStatus | 'all'
  query?: string
}

export interface CreateScheduledTaskInput {
  title: string
  prompt: string
  projectId?: string | null
  projectName?: string | null
  timezone?: string
  cadence?: ScheduledTaskCadence
  scheduleText?: string
  runMode?: ScheduledTaskRunMode
  nextRunAt?: number | null
  remindAt?: number | null
  source?: ScheduledTaskSource
  sourceSessionId?: string | null
  metadata?: Record<string, unknown>
}

export interface UpdateScheduledTaskInput {
  id: string
  title?: string
  prompt?: string
  projectId?: string | null
  projectName?: string | null
  timezone?: string
  cadence?: ScheduledTaskCadence
  scheduleText?: string
  runMode?: ScheduledTaskRunMode
  nextRunAt?: number | null
  remindAt?: number | null
  lastRunAt?: number | null
  status?: ScheduledTaskStatus
  sourceSessionId?: string | null
  metadata?: Record<string, unknown>
}

/** 一次运行由何触发：manual=手动点击运行；auto=调度器到点自动运行；pending=到期待运行被消费。 */
export type ScheduledTaskRunTrigger = 'manual' | 'auto' | 'pending'

/** 一条运行历史记录。 */
export interface ScheduledTaskRun {
  id: string
  taskId: string
  status: ScheduledTaskRunStatus
  trigger: ScheduledTaskRunTrigger
  note: string
  createdAt: number
}

/** 渲染进程上报一次运行的结果 */
export interface MarkScheduledTaskRunInput {
  id: string
  status?: ScheduledTaskRunStatus
  trigger?: ScheduledTaskRunTrigger
  note?: string
}

/** main → renderer：某个已安排任务到点触发 */
export interface ScheduledTaskFiredEvent {
  task: ScheduledTask
  mode: ScheduledTaskRunMode
  /** 本次触发对应的计划时间 */
  scheduledFor: number
  /** 是否为补偿触发（应用关闭期间错过、重新打开后追跑） */
  overdue: boolean
}
