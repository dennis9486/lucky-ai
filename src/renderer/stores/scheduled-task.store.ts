import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskFiredEvent,
  ScheduledTaskRun,
  ScheduledTaskRunStatus,
  ScheduledTaskTemplate,
  UpdateScheduledTaskInput
} from '../../shared/types/scheduled-task.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { upsertScheduledTask } from '../utils/scheduled-task-list.js'
import { createLogger } from '../../shared/utils/log.js'
import { useChatStore } from './chat.store.js'
import { useSessionStore } from './session.store.js'
import { useProjectStore } from './project.store.js'
import { useUiStore } from './ui.store.js'

const logger = createLogger('renderer/scheduled-task-store', {
  debugEnabled: () => {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } }
    return Boolean(meta.env?.DEV)
  }
})

const REMINDER_CLOCK_INTERVAL = 30 * 1000

export type ScheduledRunTrigger = 'manual' | 'auto' | 'pending'

export interface ScheduledRunResult {
  ran: boolean
  reason?: 'busy' | 'error'
}

export const useScheduledTaskStore = defineStore('scheduledTasks', () => {
  const tasks = ref<ScheduledTask[]>([])
  const templates = ref<ScheduledTaskTemplate[]>([])
  const activeTab = ref<'tasks' | 'templates'>('tasks')
  const query = ref('')
  const templateQuery = ref('')
  const loading = ref(false)
  const templateLoading = ref(false)
  const reminderNow = ref(Date.now())
  /** 原生通知点击 / 需要定位的任务 id，View 监听后高亮或打开。 */
  const focusTaskId = ref<string | null>(null)

  const currentTasks = computed(() => tasks.value.filter((task) => task.status !== 'archived'))
  const archivedTasks = computed(() => tasks.value.filter((task) => task.status === 'archived'))
  /** 已到点但尚未运行/忽略的任务（“到期待运行”）。 */
  const pendingTasks = computed(() => currentTasks.value.filter((task) => task.pendingRunAt != null))
  /**
   * Chat 只提醒任务时区“今天”已到点但未执行的 pending 任务。
   * 用户选择稍后提醒后，pending 保留，但 Chat 在 remindAt 到达前保持安静。
   */
  const chatReminderTasks = computed(() =>
    pendingTasks.value.filter((task) => {
      const pendingAt = task.pendingRunAt
      if (pendingAt == null || !isSameTaskDay(pendingAt, reminderNow.value, task.timezone)) return false
      return task.remindAt == null || task.remindAt <= reminderNow.value
    })
  )
  const nextChatReminderTask = computed(() => chatReminderTasks.value[0] ?? null)
  const pendingCount = computed(() => pendingTasks.value.length)

  let firedUnsub: (() => void) | null = null
  let openUnsub: (() => void) | null = null
  let reminderClock: ReturnType<typeof setInterval> | null = null

  /** 乐观本地更新：用 IPC 返回的任务就地合并进列表，避免再次全量重取。 */
  function applyTask(task: ScheduledTask | null | undefined): void {
    if (!task) return
    tasks.value = upsertScheduledTask(tasks.value, task, query.value)
  }

  async function load(options: { query?: string } = {}): Promise<void> {
    loading.value = true
    try {
      tasks.value = await unwrap<ScheduledTask[]>(
        ipc.scheduledTasks.list({ status: 'all', query: options.query ?? query.value })
      )
    } finally {
      loading.value = false
    }
  }

  async function loadTemplates(search = templateQuery.value): Promise<void> {
    templateLoading.value = true
    try {
      templates.value = await unwrap<ScheduledTaskTemplate[]>(ipc.scheduledTasks.templates(search))
    } finally {
      templateLoading.value = false
    }
  }

  async function create(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    const task = await unwrap<ScheduledTask>(ipc.scheduledTasks.create(input))
    applyTask(task)
    return task
  }

  async function createFromTemplate(
    templateId: string,
    overrides: Partial<CreateScheduledTaskInput> = {}
  ): Promise<ScheduledTask> {
    const task = await unwrap<ScheduledTask>(ipc.scheduledTasks.createFromTemplate(templateId, overrides))
    applyTask(task)
    activeTab.value = 'tasks'
    return task
  }

  async function update(input: UpdateScheduledTaskInput): Promise<ScheduledTask | null> {
    const task = await unwrap<ScheduledTask | null>(ipc.scheduledTasks.update(input))
    applyTask(task)
    return task
  }

  async function archive(id: string): Promise<void> {
    applyTask(await unwrap<ScheduledTask | null>(ipc.scheduledTasks.archive(id)))
  }

  /** 忽略一个“到期待运行”（不运行，仅清除 pending 标记）。 */
  async function dismissPending(id: string): Promise<void> {
    applyTask(await unwrap<ScheduledTask | null>(ipc.scheduledTasks.dismissPending(id)))
  }

  /** 推迟 Chat 中的 pending 提醒：不运行任务，也不清除 pending，只改变下次询问时间。 */
  async function snoozePending(id: string, remindAt: number): Promise<void> {
    const normalized = Number.isFinite(remindAt) ? Math.max(remindAt, Date.now() + 60 * 1000) : Date.now() + 15 * 60 * 1000
    applyTask(await update({ id, remindAt: normalized }))
    logger.info('task pending reminder snoozed', { id, remindAt: normalized })
  }

  async function markRun(
    id: string,
    status: ScheduledTaskRunStatus,
    trigger: ScheduledRunTrigger = 'manual',
    note?: string
  ): Promise<void> {
    applyTask(await unwrap<ScheduledTask | null>(ipc.scheduledTasks.markRun({ id, status, trigger, note })))
  }

  /** 拉取某任务的运行历史（最近在前）。 */
  async function listRuns(id: string, limit?: number): Promise<ScheduledTaskRun[]> {
    return unwrap<ScheduledTaskRun[]>(ipc.scheduledTasks.listRuns(id, limit))
  }

  async function activateTaskProject(task: ScheduledTask): Promise<void> {
    const projects = useProjectStore()
    if (task.projectId) {
      await projects.selectProject(task.projectId)
      return
    }
    if (!task.projectName) return
    const project = projects.projects.find((item) => item.name === task.projectName)
    if (project) await projects.selectProject(project.id)
  }

  /**
   * 运行一个已安排任务：定位/创建会话，把任务指令送入 chat agent。
   *
   * - manual：用户主动点击，可中断正在进行的对话。
   * - auto：调度器到点触发；若用户正忙（有对话在跑或草稿未发），不抢占——保留 pending，
   *   稍后用户可在“已安排”里一键运行。
   * 运行结果通过 markRun(ok/error) 落库（清除 pending、记录上次运行）。
   */
  async function runScheduledTask(
    task: ScheduledTask,
    opts: { trigger: ScheduledRunTrigger }
  ): Promise<ScheduledRunResult> {
    const chat = useChatStore()
    const sessions = useSessionStore()
    const ui = useUiStore()

    if (opts.trigger === 'auto' && (chat.isRunning || chat.input.trim().length > 0)) {
      logger.debug('auto run deferred: user busy', { id: task.id })
      return { ran: false, reason: 'busy' }
    }

    try {
      if (opts.trigger !== 'auto') chat.abortIfRunning()
      await activateTaskProject(task)

      let session = task.sourceSessionId
        ? await sessions.selectSessionWithProject(task.sourceSessionId)
        : null
      if (!session) {
        await sessions.newChat()
        session = await sessions.createSessionWithTitle(task.title)
        await update({ id: task.id, sourceSessionId: session.id })
      }

      chat.input = task.prompt
      ui.currentView = 'chat'
      await chat.sendMessage({
        runtimeSource: 'task',
        runtimeTitle: task.title,
        runtimePriority: opts.trigger === 'auto' ? 85 : 75,
        runtimeMetadata: {
          taskId: task.id,
          trigger: opts.trigger,
          runMode: task.runMode,
          pendingRunAt: task.pendingRunAt,
          nextRunAt: task.nextRunAt
        }
      })
      await markRun(task.id, 'ok', opts.trigger)
      return { ran: true }
    } catch (error) {
      logger.error('runScheduledTask failed', { id: task.id, error })
      const note = error instanceof Error ? error.message : String(error)
      await markRun(task.id, 'error', opts.trigger, note).catch(() => undefined)
      return { ran: false, reason: 'error' }
    }
  }

  /** 注册主进程“到点触发”监听：auto 立即运行，notify 仅刷新（徽标/列表自然更新）。 */
  function startFiredListener(): void {
    if (firedUnsub) return
    reminderNow.value = Date.now()
    reminderClock = setInterval(() => {
      reminderNow.value = Date.now()
    }, REMINDER_CLOCK_INTERVAL)
    firedUnsub = ipc.scheduledTasks.onFired(async (event: ScheduledTaskFiredEvent) => {
      logger.debug('task fired', { id: event.task.id, mode: event.mode, overdue: event.overdue })
      // 事件已携带 markFired 后的任务（nextRunAt 已滚动、pendingRunAt 已置），就地合并即可，无需全量重取。
      applyTask(event.task)
      if (event.mode === 'auto') {
        await runScheduledTask(event.task, { trigger: 'auto' })
      }
    })
    openUnsub = ipc.scheduledTasks.onOpen((taskId: string) => {
      const ui = useUiStore()
      ui.currentView = 'scheduled'
      activeTab.value = 'tasks'
      focusTaskId.value = taskId
      void load()
    })
  }

  function stopFiredListener(): void {
    firedUnsub?.()
    openUnsub?.()
    if (reminderClock) clearInterval(reminderClock)
    firedUnsub = null
    openUnsub = null
    reminderClock = null
  }

  return {
    tasks,
    templates,
    activeTab,
    query,
    templateQuery,
    loading,
    templateLoading,
    focusTaskId,
    currentTasks,
    archivedTasks,
    pendingTasks,
    chatReminderTasks,
    nextChatReminderTask,
    pendingCount,
    load,
    loadTemplates,
    create,
    createFromTemplate,
    update,
    markRun,
    listRuns,
    dismissPending,
    snoozePending,
    runScheduledTask,
    archive,
    startFiredListener,
    stopFiredListener
  }
})

function isSameTaskDay(left: number, right: number, timezone: string): boolean {
  return dayKey(left, timezone) === dayKey(right, timezone)
}

function dayKey(value: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(value))
    const y = parts.find((part) => part.type === 'year')?.value ?? '0000'
    const m = parts.find((part) => part.type === 'month')?.value ?? '00'
    const d = parts.find((part) => part.type === 'day')?.value ?? '00'
    return `${y}-${m}-${d}`
  } catch {
    return new Date(value).toDateString()
  }
}
