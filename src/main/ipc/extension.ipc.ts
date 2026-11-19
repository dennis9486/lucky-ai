import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import { extensionActivationService } from '../services/extension-activation.service.js'
import { extensionRuntimeService } from '../services/extension-runtime.service.js'
import { extensionService } from '../services/extension.service.js'
import { marketplaceService } from '../services/marketplace.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

export function registerExtensionIpc(): void {
  ipcMain.handle(IPC_CHANNELS.EXTENSION_LIST_INSTALLED, async () => {
    try {
      return ok(await extensionService.listInstalled())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_GET_RECOMMENDATIONS, async () => {
    try {
      return ok(await extensionService.getRecommendations())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_INSTALL_FROM_FOLDER, async (_event, path: string) => {
    try {
      return ok(await extensionService.installFromFolder(path))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_SEARCH_MARKETPLACE, async (_event, query: string, size?: number) => {
    try {
      return ok(await marketplaceService.search(query, size))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_INSTALL_FROM_MARKETPLACE, async (_event, namespace: string, name: string, version?: string) => {
    try {
      return ok(await marketplaceService.install(namespace, name, version))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_READ_README, async (_event, extensionId: string) => {
    try {
      return ok(await extensionService.readReadme(extensionId))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_UNINSTALL, async (_event, extensionId: string) => {
    try {
      await extensionService.uninstall(extensionId)
      return ok(undefined)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_SET_ENABLED, async (_event, extensionId: string, enabled: boolean) => {
    try {
      await extensionService.setEnabled(extensionId, enabled)
      return ok(undefined)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_ACTIVATE_CONTRIBUTIONS, async (_event, workspaceRoot?: string) => {
    try {
      return ok(await extensionActivationService.activateContributions(workspaceRoot))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_EXECUTE_COMMAND, async (_event, command: string, args: unknown[] = []) => {
    try {
      return ok(await extensionRuntimeService.executeCommand(command, ...args))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_LIST_COMMANDS, async () => {
    try {
      return ok(extensionRuntimeService.listCommands())
    } catch (e) {
      return fail(String(e))
    }
  })
}
