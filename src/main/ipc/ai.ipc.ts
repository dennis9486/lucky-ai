import { ipcMain, nativeTheme } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult, SettingsData } from '../../shared/types/ipc.js'
import type { AIProviderConfig } from '../../shared/types/ai.js'
import { aiService } from '../services/ai.service.js'
import { probeModelCapabilities } from '../services/model-capability.service.js'
import { settingsService } from '../services/settings.service.js'
import { commandSandboxService } from '../services/command-sandbox.service.js'
import { agentScopeManager } from '../agentscope/agent-manager.js'
import { installApplicationMenu } from '../application-menu.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    const settings = await settingsService.getSettings()
    const safe: SettingsData = {
      ...settings,
      providers: settings.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? '***' : undefined
      }))
    }
    return ok(safe)
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_GET_STATUS, async () => {
    try {
      return ok(await commandSandboxService.getStatus())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_e, partial: Partial<SettingsData>) => {
    try {
      await settingsService.setSettings(partial)
      if (partial.theme?.mode) {
        nativeTheme.themeSource = partial.theme.mode
      }
      if (partial.professionalMode !== undefined) {
        installApplicationMenu({ professionalMode: Boolean(partial.professionalMode) })
      }
      agentScopeManager.invalidateAgent()
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, async (_e, provider: AIProviderConfig) => {
    try {
      const settings = await settingsService.getSettings()
      const stored = settings.providers.find((p) => p.id === provider.id)
      const merged: AIProviderConfig = {
        ...provider,
        apiKey:
          provider.apiKey && provider.apiKey !== '***'
            ? provider.apiKey
            : stored?.apiKey
      }
      const result = await aiService.testProvider(merged)
      return ok(result)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_PROVIDER_MODELS, async (_e, provider: AIProviderConfig) => {
    try {
      const settings = await settingsService.getSettings()
      const stored = settings.providers.find((p) => p.id === provider.id)
      const merged: AIProviderConfig = {
        ...provider,
        apiKey:
          provider.apiKey && provider.apiKey !== '***'
            ? provider.apiKey
            : stored?.apiKey
      }
      return ok({ models: await aiService.listProviderModels(merged) })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /** 项目级 Provider 覆盖：读取当前覆盖 / 设置或清除（providerId=null）。 */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_PROJECT_PROVIDER, (_e, rootPath: string) => {
    try {
      return ok(settingsService.getProjectProviderOverride(String(rootPath ?? '')))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_PROJECT_PROVIDER, (_e, rootPath: string, providerId: string | null) => {
    try {
      settingsService.setProjectProviderOverride(String(rootPath ?? ''), providerId)
      // 生效 Provider 变化 → 缓存的 Agent 需要重建
      agentScopeManager.invalidateAgent()
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  /** 实测某模型的能力档案（vision/tools/streaming/json，最多 4 个最小请求）。 */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_PROBE_MODEL_CAPABILITIES, async (_e, provider: AIProviderConfig, model: string) => {
    try {
      const settings = await settingsService.getSettings()
      const stored = settings.providers.find((p) => p.id === provider.id)
      const merged: AIProviderConfig = {
        ...provider,
        apiKey:
          provider.apiKey && provider.apiKey !== '***'
            ? provider.apiKey
            : stored?.apiKey
      }
      return ok(await probeModelCapabilities(merged, model))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_INLINE_COMPLETE, async (_e, request) => {
    try {
      return ok(await aiService.completeInline(request))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_INLINE_CANCEL, async (_e, requestId: string) => {
    try {
      aiService.abort(requestId)
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_INLINE_EDIT, async (_e, request) => {
    try {
      return ok(await aiService.generateInlineEdit(request))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })
}
