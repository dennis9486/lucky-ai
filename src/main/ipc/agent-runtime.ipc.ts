import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import type {
  AgentRuntimeContextBuildInput,
  AgentRuntimeQueueInput,
  AgentRuntimeQueueUpdateInput
} from '../../shared/types/agent-runtime.js'
import { agentRuntimeService } from '../services/agent-runtime.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerAgentRuntimeIpc(getWindow: () => BrowserWindow | null): void {
  agentRuntimeService.init(getWindow)
  agentRuntimeService.start()

  ipcMain.handle(IPC_CHANNELS.AGENT_RUNTIME_GET_SNAPSHOT, () => {
    try {
      return ok(agentRuntimeService.getSnapshot())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_RUNTIME_ENQUEUE, (_e, input: AgentRuntimeQueueInput) => {
    try {
      return ok(agentRuntimeService.enqueue(input))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_RUNTIME_UPDATE_EVENT, (_e, input: AgentRuntimeQueueUpdateInput) => {
    try {
      return ok(agentRuntimeService.updateEvent(input))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_RUNTIME_BUILD_CONTEXT, async (_e, input: AgentRuntimeContextBuildInput) => {
    try {
      return ok(await agentRuntimeService.buildContextAsync(input))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_RUNTIME_SELECT_TOOLS, (_e, text: string) => {
    try {
      return ok(agentRuntimeService.selectToolsForText(text))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
}
