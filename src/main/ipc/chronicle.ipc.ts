import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import { chronicleService } from '../services/chronicle.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerChronicleIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CHRONICLE_GET_SNAPSHOT, async (_e, excludeSessionId?: string) => {
    try {
      const snapshot = await chronicleService.buildSnapshot(excludeSessionId)
      return ok(snapshot)
    } catch (e) {
      return fail(String(e))
    }
  })
}

export async function getChroniclePromptBlock(excludeSessionId?: string): Promise<string> {
  const snapshot = await chronicleService.buildSnapshot(excludeSessionId)
  return chronicleService.formatForPrompt(snapshot)
}
