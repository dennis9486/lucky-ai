import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult, MarkScheduledTaskRunInput } from '../../shared/types/ipc.js'
import { scheduledTaskService } from '../services/scheduled-task.service.js'
import { scheduledTaskScheduler } from '../services/scheduled-task-scheduler.js'
import { pageMonitorService } from '../services/page-monitor.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerScheduledTaskIpc(getWindow: () => BrowserWindow | null): void {
  scheduledTaskScheduler.init(getWindow)
  scheduledTaskScheduler.start()
  // 页面变化监控与任务调度共用窗口获取器，同一时机启动
  pageMonitorService.init(getWindow)
  pageMonitorService.start()

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_LIST, async (_e, options) => {
    try {
      return ok(scheduledTaskService.list(options))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_TEMPLATES, async (_e, query) => {
    try {
      return ok(scheduledTaskService.listTemplates(query))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_CREATE, async (_e, input) => {
    try {
      return ok(scheduledTaskService.create(input))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_CREATE_FROM_TEMPLATE, async (_e, templateId, overrides) => {
    try {
      return ok(scheduledTaskService.createFromTemplate(templateId, overrides))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_UPDATE, async (_e, input) => {
    try {
      return ok(scheduledTaskService.update(input))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_RUN_NOW, async (_e, id) => {
    try {
      return ok(scheduledTaskService.runNow(id))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_MARK_RUN, async (_e, input: MarkScheduledTaskRunInput) => {
    try {
      return ok(scheduledTaskService.markRun(input.id, input.status, input.trigger, input.note))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_LIST_RUNS, async (_e, id: string, limit?: number) => {
    try {
      return ok(scheduledTaskService.listRuns(id, limit ?? 20))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_DISMISS_PENDING, async (_e, id: string) => {
    try {
      return ok(scheduledTaskService.dismissPending(id))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASKS_ARCHIVE, async (_e, id) => {
    try {
      return ok(scheduledTaskService.archive(id))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
}
