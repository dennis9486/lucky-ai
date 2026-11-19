import { ipcMain, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { IpcResult, SaveTextFileInput } from '../../shared/types/ipc.js'
import type {
  EditorWorkspaceState,
  FileContentReplaceOptions,
  FileContentSearchOptions
} from '../../shared/types/workspace.js'
import { workspaceService } from '../services/workspace.service.js'
import { agentScopeManager } from '../agentscope/agent-manager.js'
import { fileService } from '../services/file.service.js'
import { securityService } from '../services/security.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

/** 取用户可读的错误消息（GitError 等自定义 Error 不带 "Error:" 前缀噪声） */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET, async (_e, rootPath: string) => {
    try {
      const ws = workspaceService.setWorkspace(rootPath)
      await agentScopeManager.onWorkspaceChanged(rootPath)
      return ok(ws)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET, () => {
    return ok(workspaceService.getWorkspace())
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_TREE, async (_e, relativePath?: string) => {
    try {
      const tree = await workspaceService.getTree(relativePath)
      return ok(tree)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SEARCH_FILES, async (_e, query: string) => {
    try {
      const results = await fileService.searchFiles(query)
      return ok(results)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SEARCH_CONTENT, async (_e, options: FileContentSearchOptions) => {
    try {
      const results = await fileService.searchContent(options)
      return ok(results)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REPLACE_CONTENT, async (_e, options: FileContentReplaceOptions) => {
    try {
      const results = await fileService.replaceContent(options)
      return ok(results)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_EDITOR_STATE, async (_e, rootPath?: string) => {
    try {
      return ok(workspaceService.getEditorState(rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_EDITOR_STATE, async (_e, state: EditorWorkspaceState, rootPath?: string) => {
    try {
      workspaceService.setEditorState(state, rootPath)
      return ok(undefined)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_GIT_BRANCH, async (_e, rootPath?: string) => {
    try {
      const branch = await workspaceService.getGitBranch(rootPath)
      return ok(branch)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS, async (_e, rootPath?: string) => {
    try {
      const status = await workspaceService.getGitStatus(rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST_GIT_BRANCHES, async (_e, rootPath?: string) => {
    try {
      const branches = await workspaceService.listGitBranches(rootPath)
      return ok(branches)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CHECKOUT_GIT_BRANCH, async (_e, branch: string, rootPath?: string) => {
    try {
      const status = await workspaceService.checkoutGitBranch(branch, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE_GIT_BRANCH, async (_e, branch: string, rootPath?: string) => {
    try {
      const status = await workspaceService.createGitBranch(branch, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_GIT_FILE_DIFF, async (_e, path: string, rootPath?: string) => {
    try {
      const diff = await workspaceService.getGitFileDiff(path, rootPath)
      return ok(diff)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_GIT_FILE_HUNKS, async (_e, path: string, rootPath?: string, staged?: boolean) => {
    try {
      const hunks = await workspaceService.getGitFileHunks(path, rootPath, Boolean(staged))
      return ok(hunks)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_STAGE_GIT_FILE, async (_e, path: string, rootPath?: string) => {
    try {
      const status = await workspaceService.stageGitFile(path, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UNSTAGE_GIT_FILE, async (_e, path: string, rootPath?: string) => {
    try {
      const status = await workspaceService.unstageGitFile(path, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_STAGE_GIT_HUNK, async (_e, path: string, hunkIndex: number, rootPath?: string, staged?: boolean) => {
    try {
      const status = await workspaceService.stageGitHunk(path, hunkIndex, rootPath, Boolean(staged))
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UNSTAGE_GIT_HUNK, async (_e, path: string, hunkIndex: number, rootPath?: string) => {
    try {
      const status = await workspaceService.unstageGitHunk(path, hunkIndex, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_FETCH_GIT, async (_e, rootPath?: string) => {
    try {
      const status = await workspaceService.fetchGit(rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_GIT_CONFLICT_FILE, async (_e, path: string, rootPath?: string) => {
    try {
      return ok(await workspaceService.getGitConflictFile(path, rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RESOLVE_GIT_CONFLICT_FILE, async (_e, path: string, content: string, rootPath?: string) => {
    try {
      return ok(await workspaceService.resolveGitConflictFile(path, content, rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PULL_GIT, async (_e, rootPath?: string) => {
    try {
      const result = await workspaceService.pullGit(rootPath)
      return ok(result)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PUSH_GIT, async (_e, rootPath?: string, setUpstream?: boolean) => {
    try {
      const result = await workspaceService.pushGit(rootPath, Boolean(setUpstream))
      return ok(result)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DISCARD_GIT_FILE, async (_e, path: string, rootPath?: string) => {
    try {
      const status = await workspaceService.discardGitFile(path, rootPath)
      return ok(status)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SUGGEST_COMMIT_MESSAGE, async (_e, rootPath?: string) => {
    try {
      const message = await workspaceService.suggestCommitMessage(rootPath)
      return ok(message)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REVIEW_GIT_CHANGES, async (_e, rootPath?: string) => {
    try {
      const review = await workspaceService.reviewGitChanges(rootPath)
      return ok(review)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_COMMIT_ALL, async (_e, message: string, rootPath?: string, amend?: boolean) => {
    try {
      const result = await workspaceService.commitAll(message, rootPath, Boolean(amend))
      return ok(result)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_COMMIT_STAGED, async (_e, message: string, rootPath?: string, amend?: boolean) => {
    try {
      const result = await workspaceService.commitStaged(message, rootPath, Boolean(amend))
      return ok(result)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST_GIT_STASHES, async (_e, rootPath?: string) => {
    try {
      return ok(await workspaceService.listGitStashes(rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PUSH_GIT_STASH, async (_e, message: string, rootPath?: string) => {
    try {
      return ok(await workspaceService.pushGitStash(message, rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_APPLY_GIT_STASH, async (_e, index: number, pop?: boolean, rootPath?: string) => {
    try {
      return ok(await workspaceService.applyGitStash(index, Boolean(pop), rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DROP_GIT_STASH, async (_e, index: number, rootPath?: string) => {
    try {
      return ok(await workspaceService.dropGitStash(index, rootPath))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST_GIT_GRAPH, async (_e, rootPath?: string, limit?: number) => {
    try {
      return ok(await workspaceService.listGitGraph(rootPath, limit))
    } catch (e) {
      return fail(errorMessage(e))
    }
  })
}

export function registerFileIpc(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_e, path: string) => {
    try {
      const result = await fileService.readFile(path)
      return ok(result)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_e, path: string, content: string) => {
    try {
      securityService.checkToolPermission('write_file', { path }, true)
      await fileService.writeFile(path, content)
      return ok(undefined)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_e, path: string) => {
    try {
      securityService.checkToolPermission('write_file', { path }, true)
      await fileService.deleteFile(path)
      return ok(undefined)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_CREATE, async (_e, path: string, content?: string) => {
    try {
      await fileService.createFile(path, content ?? '')
      return ok(undefined)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, async (_e, fromPath: string, toPath: string) => {
    try {
      securityService.checkToolPermission('write_file', { path: fromPath }, true)
      securityService.checkToolPermission('write_file', { path: toPath }, true)
      await fileService.renameFile(fromPath, toPath)
      return ok(undefined)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_EXISTS, async (_e, path: string) => {
    try {
      const exists = await fileService.exists(path)
      return ok(exists)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return fail('已取消')
    }
    return ok(result.filePaths[0])
  })

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_ATTACHMENT_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return fail('已取消')
    }
    return ok(result.filePaths)
  })

  ipcMain.handle(IPC_CHANNELS.APP_SAVE_TEXT_FILE, async (_e, input: SaveTextFileInput) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: input.defaultPath,
        filters: input.filters?.length ? input.filters : [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return ok(null)
      await writeFile(result.filePath, input.content, 'utf8')
      return ok(result.filePath)
    } catch (e) {
      return fail(errorMessage(e))
    }
  })
}
