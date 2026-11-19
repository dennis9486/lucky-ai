import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult, RunCommandResult } from '../../shared/types/ipc.js'
import { terminalService } from '../services/terminal.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerTerminalIpc(): void {
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, (event, cwd?: string) => {
    try {
      const session = terminalService.createSession(cwd, event.sender)
      return ok(session)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_e, id: string, data: string) => {
    try {
      terminalService.write(id, data)
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_e, id: string, cols: number, rows: number) => {
    terminalService.resize(id, cols, rows)
    return ok(undefined)
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_KILL, (_e, id: string) => {
    terminalService.kill(id)
    return ok(undefined)
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_GET_OUTPUT, (_e, id?: string) => {
    return ok({ id: id ?? 'global', output: terminalService.getOutput(id) })
  })

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RUN_COMMAND,
    async (_e, command: string, cwd?: string, confirmed?: boolean): Promise<IpcResult<RunCommandResult>> => {
      try {
        const result = await terminalService.runCommand(command, cwd ?? '.', confirmed ?? false)
        return ok(result)
      } catch (e) {
        return fail(String(e))
      }
    }
  )
}
