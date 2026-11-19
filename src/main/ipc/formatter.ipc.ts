import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { FormatFileRequest, IpcResult } from '../../shared/types/ipc.js'
import { formatterService } from '../services/formatter.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerFormatterIpc(): void {
  ipcMain.handle(IPC_CHANNELS.FORMATTER_FORMAT, async (_e, request: FormatFileRequest) => {
    try {
      const result = await formatterService.formatFile(request)
      return ok(result)
    } catch (e) {
      return fail(String(e))
    }
  })
}
