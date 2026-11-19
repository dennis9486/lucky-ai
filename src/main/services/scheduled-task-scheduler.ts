import { Notification, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { ScheduledTask, ScheduledTaskFiredEvent } from '../../shared/types/scheduled-task.js'
import { createLogger } from '../../shared/utils/log.js'
import { scheduledTaskService } from './scheduled-task.service.js'

const logger = createLogger('main/scheduled-task-scheduler')

/** 轮询间隔：分钟级排期下 30s 足够精确，且开销极低。 */
const TICK_INTERVAL = 30_000
/** 启动后延迟首扫，给窗口/渲染进程监听器就绪留出时间。 */
const STARTUP_DELAY = 5_000
/** 触发时间晚于计划 2 分钟以上视为“补偿触发”（应用关闭期间错过）。 */
const OVERDUE_THRESHOLD = 2 * 60_000

/**
 * 已安排任务调度器（主进程）。
 *
 * 职责单一：到点把 active 任务“点火”——滚动排期、置 pending，并通知渲染进程。
 * 实际运行 agent 由渲染进程消费 fired 事件完成（agent loop 是渲染进程驱动的）。
 *
 * - notify 模式：弹原生通知 + 发 fired 事件（渲染进程更新“到期”徽标/列表，等用户一键运行）。
 * - auto 模式：发 fired 事件让渲染进程立即运行；无窗口可发时退化为原生通知 + 保留 pending，
 *   下次打开应用仍可见、可补跑——不丢任务。
 * - 多次错过的运行会被合并为一次点火（markFired 从 now 之后重算 next），不会通知风暴。
 */
class ScheduledTaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private getWindow: (() => BrowserWindow | null) | null = null
  private running = false

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  start(): void {
    if (this.running) return
    this.running = true
    logger.info('scheduler start', { tickInterval: TICK_INTERVAL })
    this.startupTimer = setTimeout(() => this.tick(), STARTUP_DELAY)
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL)
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.timer) clearInterval(this.timer)
    this.startupTimer = null
    this.timer = null
    this.running = false
  }

  /** 供原生通知点击、或外部手动触发一次扫描。 */
  tick(now: number = Date.now()): void {
    let due: ScheduledTask[]
    try {
      due = scheduledTaskService.listDue(now)
    } catch (error) {
      logger.error('listDue failed', { error })
      return
    }
    if (due.length) {
      logger.info('due tasks', { count: due.length })
      for (const task of due) {
        try {
          this.fire(task, now)
        } catch (error) {
          logger.error('fire task failed', { id: task.id, error })
        }
      }
    }
    this.tickReminders(now)
  }

  /**
   * 到点的「稍后提醒 / 失败重试」重新点火：pending 任务的 remind_at 到期后
   * 再次发 fired 事件（auto 重试即重跑，notify 即再次提醒），并消费 remind_at
   * 防止每个 tick 重复触发。下一次重试的 remind 由 markRun(error) 重新排。
   */
  private tickReminders(now: number): void {
    let reminders: ScheduledTask[]
    try {
      reminders = scheduledTaskService.listRemindDue(now)
    } catch (error) {
      logger.error('listRemindDue failed', { error })
      return
    }
    for (const task of reminders) {
      try {
        scheduledTaskService.consumeRemind(task.id)
        const retryCount = Number(task.metadata?.retryCount ?? 0) || 0
        logger.info('re-fire pending task', { id: task.id, retryCount })
        const event: ScheduledTaskFiredEvent = {
          task,
          mode: task.runMode,
          scheduledFor: task.pendingRunAt ?? now,
          overdue: true
        }
        const delivered = this.emit(event)
        if (task.runMode === 'notify' || !delivered) this.notify(task, true)
      } catch (error) {
        logger.error('re-fire task failed', { id: task.id, error })
      }
    }
  }

  private fire(task: ScheduledTask, now: number): void {
    const scheduledFor = task.nextRunAt ?? now
    const overdue = now - scheduledFor > OVERDUE_THRESHOLD
    const updated = scheduledTaskService.markFired(task.id, now) ?? task
    const event: ScheduledTaskFiredEvent = { task: updated, mode: task.runMode, scheduledFor, overdue }
    const delivered = this.emit(event)
    // notify 模式总是弹通知；auto 模式仅在无法投递到渲染进程时退化为通知。
    if (task.runMode === 'notify' || !delivered) this.notify(updated, overdue)
  }

  private emit(event: ScheduledTaskFiredEvent): boolean {
    const win = this.getWindow?.()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false
    win.webContents.send(IPC_CHANNELS.SCHEDULED_TASKS_FIRED, event)
    return true
  }

  private notify(task: ScheduledTask, overdue: boolean): void {
    if (!Notification.isSupported()) return
    const title = overdue ? `已安排任务（已逾期）：${task.title}` : `已安排任务：${task.title}`
    const body = task.runMode === 'auto' ? '正在为你运行…' : '点击打开 Lucky 一键运行。'
    const notification = new Notification({ title, body })
    notification.on('click', () => {
      const win = this.getWindow?.()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SCHEDULED_TASKS_OPEN, task.id)
      }
    })
    notification.show()
  }
}

export const scheduledTaskScheduler = new ScheduledTaskScheduler()
