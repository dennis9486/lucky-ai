import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkspaceInfo, FileTreeNode } from '../../shared/types/workspace.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { useEditorStore } from './editor.store.js'
import { useTerminalStore } from './terminal.store.js'
import { createLogger } from '../../shared/utils/log.js'

const logger = createLogger('renderer/workspace-store')

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspace = ref<WorkspaceInfo | null>(null)
  const tree = ref<FileTreeNode[]>([])
  const loading = ref(false)

  async function openFolder(): Promise<void> {
    let path: string
    try {
      path = await unwrap<string>(ipc.app.openFolderDialog())
    } catch (e) {
      if (isDialogCancel(e)) return
      throw e
    }
    await setWorkspace(path)
  }

  async function setWorkspace(rootPath: string): Promise<void> {
    const editor = useEditorStore()
    const terminal = useTerminalStore()
    const switchingWorkspace = workspace.value?.rootPath !== rootPath
    await editor.flushWorkspaceState().catch((error) => {
      logger.warn('failed to persist editor state before switching workspace', { error })
    })
    if (switchingWorkspace) {
      // Terminal PTYs are tied to the old cwd; close them before changing the workspace root.
      logger.info('closing terminal sessions before workspace switch', {
        from: workspace.value?.rootPath ?? null,
        to: rootPath
      })
      await terminal.closePanel().catch((error) => {
        logger.warn('failed to close terminal sessions before switching workspace', { error })
      })
    }
    loading.value = true
    try {
      workspace.value = await unwrap<WorkspaceInfo>(ipc.workspace.set(rootPath))
      await refreshTree()
      await editor.restoreWorkspaceState(workspace.value.rootPath)
    } finally {
      loading.value = false
    }
  }

  async function refreshTree(): Promise<void> {
    tree.value = await unwrap<FileTreeNode[]>(ipc.workspace.getTree())
  }

  return { workspace, tree, loading, openFolder, setWorkspace, refreshTree }
})

function isDialogCancel(error: unknown): boolean {
  return error instanceof Error
    ? error.message.includes('取消') || error.message.toLowerCase().includes('cancel')
    : String(error).includes('取消')
}
