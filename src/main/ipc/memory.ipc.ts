import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult, MemoryCaptureRequest, MemoryCreateInput, MemoryListOptions } from '../../shared/types/ipc.js'
import { memoryService } from '../services/memory.service.js'
import { settingsService } from '../services/settings.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerMemoryIpc(): void {
  ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, async (_e, options?: MemoryListOptions) => {
    try {
      return ok(await memoryService.list(options))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_COUNT, async () => {
    try {
      return ok(await memoryService.count())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_RESET, async () => {
    try {
      await memoryService.reset()
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_CAPTURE, async (_e, request: MemoryCaptureRequest) => {
    try {
      const settings = await settingsService.getSettings()
      const memory = await memoryService.maybeCapture(request, settings.personalization)
      return ok(memory?.id ?? null)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_CREATE, async (_e, input: MemoryCreateInput) => {
    try {
      return ok(await memoryService.create(input))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_ARCHIVE, async (_e, id: string) => {
    try {
      return ok(await memoryService.archive(id))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, async (_e, id: string) => {
    try {
      return ok(await memoryService.delete(id))
    } catch (e) {
      return fail(String(e))
    }
  })
}
