import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import type { ConfiguredSkill, SaveConfiguredSkillInput } from '../../shared/types/skill.js'
import { agentScopeManager } from '../agentscope/agent-manager.js'
import { deleteSkill, listConfiguredSkills, saveSkill, setSkillEnabled } from '../agentscope/learned-skills.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerSkillsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async (): Promise<IpcResult<ConfiguredSkill[]>> => {
    try {
      return ok(await listConfiguredSkills())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_SAVE, async (_e, input: SaveConfiguredSkillInput): Promise<IpcResult<void>> => {
    try {
      await saveSkill(input)
      agentScopeManager.invalidateAgent()
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_SET_ENABLED, async (_e, id: string, enabled: boolean): Promise<IpcResult<void>> => {
    try {
      await setSkillEnabled(String(id ?? ''), Boolean(enabled))
      agentScopeManager.invalidateAgent()
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_e, id: string): Promise<IpcResult<void>> => {
    try {
      await deleteSkill(String(id ?? ''))
      agentScopeManager.invalidateAgent()
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
}
