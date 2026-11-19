import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import type { UpdaterState } from '../../shared/types/updater.js'
import { updaterService } from '../services/updater.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerUpdaterIpc(getWindow: () => BrowserWindow | null): void {
  updaterService.init(getWindow)

  ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATE, async () => {
    try {
      return ok<UpdaterState>(updaterService.getState())
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
    try {
      return ok<UpdaterState>(await updaterService.check(true))
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async () => {
    try {
      return ok<UpdaterState>(await updaterService.download())
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL, async () => {
    try {
      updaterService.install()
      return ok(undefined)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  })
}
