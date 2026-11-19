import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, isAllowedChannel } from '../shared/constants/ipc-channels.js'
import type {
  AgentConfirmRequest,
  AgentScopeEvent,
  AgentSendRequest,
  AgentTitleSummaryRequest
} from '../shared/types/agentscope.js'
import type { ChatMessage } from '../shared/types/ai.js'
import type {
  ConversationState,
  CreateSessionInput,
  LegacyConversationImport,
  LegacyImportResult,
  SessionDetail,
  SessionSummary,
  UpdateSessionInput
} from '../shared/types/conversation.js'
import type { ProjectEntry } from '../shared/types/project.js'
import type { UpdaterState } from '../shared/types/updater.js'
import type {
  EditorWorkspaceState,
  FileContentReplaceOptions,
  FileContentReplaceResult,
  FileContentSearchOptions,
  FileContentSearchResult,
  AIInlineCompletionRequest,
  AIInlineCompletionResult,
  AIInlineEditRequest,
  AIInlineEditResult,
  FileReadResult,
  FileSearchResult,
  FileTreeNode,
  WorkspaceGitCommitResult,
  WorkspaceGitStashEntry,
  WorkspaceGitFileDiff,
  WorkspaceGitFileHunks,
  WorkspaceGitReviewResult,
  WorkspaceGitStatus,
  IpcResult,
  AgentMcpServerConfig,
  AgentTurnCheckpointFile,
  AgentTurnRevertResult,
  AgentUsageSummary,
  McpServerTestResult,
  RunCommandResult,
  SettingsData,
  ProviderModelListResult,
  WorkspaceInfo,
  WorkspaceGitBranch,
  MemoryCaptureRequest,
  AgentMemory,
  MemoryCreateInput,
  MemoryListOptions,
  CreateScheduledTaskInput,
  MarkScheduledTaskRunInput,
  ScheduledTask,
  ScheduledTaskFiredEvent,
  ScheduledTaskListOptions,
  ScheduledTaskRun,
  ScheduledTaskTemplate,
  UpdateScheduledTaskInput,
  PastedImageInput,
  SavedAttachment,
  SaveTextFileInput
} from '../shared/types/ipc.js'
import type { ExtensionInstallResult } from '../shared/types/extension.js'
import type {
  AgentRuntimeContextBuildInput,
  AgentRuntimeContextBuildResult,
  AgentRuntimeQueueInput,
  AgentRuntimeQueueItem,
  AgentRuntimeQueueUpdateInput,
  AgentRuntimeSnapshot,
  AgentRuntimeToolRegistryItem
} from '../shared/types/agent-runtime.js'
import { isAppMenuCommand, type AppMenuCommand } from '../shared/types/menu.js'
import { lspElapsed, lspError, lspLog, shortLspPath } from '../shared/utils/lsp-log.js'

/** 安全的 IPC invoke — 只允许白名单通道 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  if (!isAllowedChannel(channel)) {
    return Promise.resolve({ success: false, error: `IPC 通道未授权: ${channel}` })
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
}

function summarizeLspInvokeArg(arg: unknown): Record<string, unknown> {
  if (!arg || typeof arg !== 'object') return {}
  const record = arg as Record<string, unknown>
  const detail: Record<string, unknown> = {}
  if (typeof record.languageId === 'string') detail.languageId = record.languageId
  if (typeof record.method === 'string') detail.method = record.method
  if (typeof record.path === 'string') detail.path = shortLspPath(record.path)
  if (typeof record.version === 'number') detail.version = record.version
  if (typeof record.workspaceRoot === 'string') detail.workspaceRoot = shortLspPath(record.workspaceRoot)
  if (typeof record.lineNumber === 'number') detail.line = record.lineNumber
  if (typeof record.column === 'number') detail.column = record.column
  return detail
}

async function invokeLsp<T>(label: string, channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const detail = summarizeLspInvokeArg(args[0])
  const startedAt = Date.now()
  const quiet = label === 'documentChange'
  if (!quiet) lspLog('preload', `→ ${label}`, detail)
  const result = await invoke<T>(channel, ...args)
  if (quiet) return result
  if (result.success) {
    lspLog('preload', `← ${label}`, { ...detail, ms: lspElapsed(startedAt), ok: true })
  } else {
    lspError('preload', `← ${label} failed`, {
      ...detail,
      ms: lspElapsed(startedAt),
      error: result.error ?? 'unknown error'
    })
  }
  return result
}

const api = {
  app: {
    getVersion: (): Promise<IpcResult<string>> => invoke(IPC_CHANNELS.APP_GET_VERSION),
    openExternal: (url: string): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    openPath: (path: string): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.APP_OPEN_PATH, path),
    showItemInFolder: (path: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.APP_SHOW_ITEM_IN_FOLDER, path),
    openFolderDialog: (): Promise<IpcResult<string>> => invoke(IPC_CHANNELS.APP_OPEN_FOLDER_DIALOG),
    openAttachmentDialog: (): Promise<IpcResult<string[]>> =>
      invoke(IPC_CHANNELS.APP_OPEN_ATTACHMENT_DIALOG),
    savePastedImage: (input: PastedImageInput): Promise<IpcResult<SavedAttachment>> =>
      invoke(IPC_CHANNELS.APP_SAVE_PASTED_IMAGE, input),
    saveTextFile: (input: SaveTextFileInput): Promise<IpcResult<string | null>> =>
      invoke(IPC_CHANNELS.APP_SAVE_TEXT_FILE, input),
    reportError: (report: {
      kind: 'error' | 'unhandledrejection'
      message: string
      source?: string
      line?: number
      column?: number
      stack?: string
    }): void => {
      // fire-and-forget：诊断上报不阻塞、不抛错
      void ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_REPORT_ERROR, report).catch(() => undefined)
    },
    createWindow: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.WINDOW_CREATE),
    setFullscreen: (fullscreen: boolean): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.WINDOW_SET_FULLSCREEN, fullscreen),
    onFullscreenChanged: (handler: (fullscreen: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, fullscreen: boolean) => handler(fullscreen)
      ipcRenderer.on(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, listener)
    },
    onMenuCommand: (handler: (command: AppMenuCommand) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, command: string) => {
        if (isAppMenuCommand(command)) handler(command)
      }
      ipcRenderer.on(IPC_CHANNELS.APP_MENU_COMMAND, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_MENU_COMMAND, listener)
    },
    /** 主进程请求向聊天发送一条 prompt（浏览器右键「AI 总结/解释」等入口） */
    onChatPrompt: (handler: (prompt: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, prompt: string) => {
        if (typeof prompt === 'string' && prompt.trim()) handler(prompt)
      }
      ipcRenderer.on(IPC_CHANNELS.CHAT_SEND_PROMPT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SEND_PROMPT, listener)
    }
  },

  updater: {
    getState: (): Promise<IpcResult<UpdaterState>> => invoke(IPC_CHANNELS.UPDATER_GET_STATE),
    check: (): Promise<IpcResult<UpdaterState>> => invoke(IPC_CHANNELS.UPDATER_CHECK),
    download: (): Promise<IpcResult<UpdaterState>> => invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
    install: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.UPDATER_INSTALL),
    onStatus: (handler: (state: UpdaterState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: UpdaterState) => handler(state)
      ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATUS, listener)
    }
  },

  workspace: {
    set: (rootPath: string): Promise<IpcResult<WorkspaceInfo>> => invoke(IPC_CHANNELS.WORKSPACE_SET, rootPath),
    /** 订阅 .git 变化广播（终端/Agent 改动仓库时触发），返回取消订阅函数 */
    onGitChanged: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.WORKSPACE_GIT_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKSPACE_GIT_CHANGED, handler)
    },
    get: (): Promise<IpcResult<WorkspaceInfo | null>> => invoke(IPC_CHANNELS.WORKSPACE_GET),
    getTree: (relativePath?: string): Promise<IpcResult<FileTreeNode[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_TREE, relativePath),
    searchFiles: (query: string): Promise<IpcResult<FileSearchResult[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_SEARCH_FILES, query),
    searchContent: (options: FileContentSearchOptions): Promise<IpcResult<FileContentSearchResult[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_SEARCH_CONTENT, options),
    replaceContent: (options: FileContentReplaceOptions): Promise<IpcResult<FileContentReplaceResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_REPLACE_CONTENT, options),
    getEditorState: (rootPath?: string): Promise<IpcResult<EditorWorkspaceState | null>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_EDITOR_STATE, rootPath),
    setEditorState: (state: EditorWorkspaceState, rootPath?: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.WORKSPACE_SET_EDITOR_STATE, state, rootPath),
    getGitBranch: (rootPath?: string): Promise<IpcResult<string | null>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_BRANCH, rootPath),
    getGitStatus: (rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS, rootPath),
    listGitBranches: (rootPath?: string): Promise<IpcResult<WorkspaceGitBranch[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_LIST_GIT_BRANCHES, rootPath),
    checkoutGitBranch: (branch: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_CHECKOUT_GIT_BRANCH, branch, rootPath),
    createGitBranch: (branch: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_CREATE_GIT_BRANCH, branch, rootPath),
    getGitFileDiff: (path: string, rootPath?: string): Promise<IpcResult<WorkspaceGitFileDiff>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_FILE_DIFF, path, rootPath),
    getGitFileHunks: (path: string, rootPath?: string, staged?: boolean): Promise<IpcResult<WorkspaceGitFileHunks>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_FILE_HUNKS, path, rootPath, staged),
    stageGitFile: (path: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_STAGE_GIT_FILE, path, rootPath),
    unstageGitFile: (path: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_UNSTAGE_GIT_FILE, path, rootPath),
    stageGitHunk: (path: string, hunkIndex: number, rootPath?: string, staged?: boolean): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_STAGE_GIT_HUNK, path, hunkIndex, rootPath, staged),
    unstageGitHunk: (path: string, hunkIndex: number, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_UNSTAGE_GIT_HUNK, path, hunkIndex, rootPath),
    fetchGit: (rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_FETCH_GIT, rootPath),
    pullGit: (rootPath?: string): Promise<IpcResult<import('../shared/types/workspace.js').WorkspaceGitSyncResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_PULL_GIT, rootPath),
    pushGit: (rootPath?: string, setUpstream?: boolean): Promise<IpcResult<import('../shared/types/workspace.js').WorkspaceGitSyncResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_PUSH_GIT, rootPath, setUpstream),
    getGitConflictFile: (path: string, rootPath?: string): Promise<IpcResult<import('../shared/types/workspace.js').WorkspaceGitConflictFile>> =>
      invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_CONFLICT_FILE, path, rootPath),
    resolveGitConflictFile: (path: string, content: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_RESOLVE_GIT_CONFLICT_FILE, path, content, rootPath),
    discardGitFile: (path: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_DISCARD_GIT_FILE, path, rootPath),
    suggestCommitMessage: (rootPath?: string): Promise<IpcResult<string>> =>
      invoke(IPC_CHANNELS.WORKSPACE_SUGGEST_COMMIT_MESSAGE, rootPath),
    reviewGitChanges: (rootPath?: string): Promise<IpcResult<WorkspaceGitReviewResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_REVIEW_GIT_CHANGES, rootPath),
    commitAll: (message: string, rootPath?: string, amend?: boolean): Promise<IpcResult<WorkspaceGitCommitResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_COMMIT_ALL, message, rootPath, amend),
    commitStaged: (message: string, rootPath?: string, amend?: boolean): Promise<IpcResult<WorkspaceGitCommitResult>> =>
      invoke(IPC_CHANNELS.WORKSPACE_COMMIT_STAGED, message, rootPath, amend),
    listGitStashes: (rootPath?: string): Promise<IpcResult<WorkspaceGitStashEntry[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_LIST_GIT_STASHES, rootPath),
    pushGitStash: (message: string, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_PUSH_GIT_STASH, message, rootPath),
    applyGitStash: (index: number, pop?: boolean, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_APPLY_GIT_STASH, index, pop, rootPath),
    dropGitStash: (index: number, rootPath?: string): Promise<IpcResult<WorkspaceGitStatus>> =>
      invoke(IPC_CHANNELS.WORKSPACE_DROP_GIT_STASH, index, rootPath),
    listGitGraph: (rootPath?: string, limit?: number): Promise<IpcResult<import('../shared/types/workspace.js').WorkspaceGitGraphLine[]>> =>
      invoke(IPC_CHANNELS.WORKSPACE_LIST_GIT_GRAPH, rootPath, limit)
  },

  file: {
    read: (path: string): Promise<IpcResult<FileReadResult>> => invoke(IPC_CHANNELS.FILE_READ, path),
    write: (path: string, content: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.FILE_WRITE, path, content),
    delete: (path: string): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.FILE_DELETE, path),
    create: (path: string, content?: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.FILE_CREATE, path, content),
    rename: (fromPath: string, toPath: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.FILE_RENAME, fromPath, toPath),
    exists: (path: string): Promise<IpcResult<boolean>> => invoke(IPC_CHANNELS.FILE_EXISTS, path)
  },

  terminal: {
    create: (cwd?: string): Promise<IpcResult<{ id: string; shellName: string; cwd: string }>> =>
      invoke(IPC_CHANNELS.TERMINAL_CREATE, cwd),
    write: (id: string, data: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.TERMINAL_WRITE, id, data),
    resize: (id: string, cols: number, rows: number): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.TERMINAL_RESIZE, id, cols, rows),
    kill: (id: string): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.TERMINAL_KILL, id),
    getOutput: (id?: string): Promise<IpcResult<{ id: string; output: string }>> =>
      invoke(IPC_CHANNELS.TERMINAL_GET_OUTPUT, id),
    runCommand: (command: string, cwd?: string, confirmed?: boolean): Promise<IpcResult<RunCommandResult>> =>
      invoke(IPC_CHANNELS.TERMINAL_RUN_COMMAND, command, cwd, confirmed),
    onData: (handler: (payload: { id: string; data: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; data: string }) => {
        handler(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, listener)
    }
  },

  agent: {
    send: (
      request: AgentSendRequest,
      onEvent: (event: AgentScopeEvent) => void
    ): Promise<IpcResult<string>> => {
      // 渲染进程预生成 requestId，并在 invoke 之前订阅事件通道，
      // 避免主进程在订阅完成前就 emit（早期错误/快速回复丢失 → 卡死无响应）。
      const requestId = request.requestId ?? globalThis.crypto.randomUUID()
      const channel = `${IPC_CHANNELS.AGENT_EVENT}:${requestId}`
      const handler = (_event: IpcRendererEvent, evt: AgentScopeEvent) => {
        onEvent(evt)
        if (evt.type === 'reply_end' || evt.type === 'error') {
          ipcRenderer.removeListener(channel, handler)
        }
      }
      ipcRenderer.on(channel, handler)

      return invoke<string>(IPC_CHANNELS.AGENT_SEND, { ...request, requestId }).then((result) => {
        if (!result.success) {
          ipcRenderer.removeListener(channel, handler)
          return result
        }
        return { success: true, data: requestId }
      }).catch((e: unknown) => {
        ipcRenderer.removeListener(channel, handler)
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      })
    },
    confirm: (req: AgentConfirmRequest): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.AGENT_CONFIRM, req),
    confirmAll: (
      sessionId: string,
      replyId: string,
      results: Array<{ toolCallId: string; confirmed: boolean }>
    ): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.AGENT_CONFIRM_ALL, sessionId, replyId, results),
    abort: (sessionId: string): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.AGENT_ABORT, sessionId),
    reset: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.AGENT_RESET),
    resetConversation: (conversationId: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.AGENT_RESET_CONVERSATION, conversationId),
    getUsageSummary: (days?: number): Promise<IpcResult<AgentUsageSummary>> =>
      invoke(IPC_CHANNELS.AGENT_GET_USAGE_SUMMARY, days),
    listTurnCheckpoints: (turnId: string): Promise<IpcResult<AgentTurnCheckpointFile[]>> =>
      invoke(IPC_CHANNELS.AGENT_LIST_TURN_CHECKPOINTS, turnId),
    revertTurn: (turnId: string): Promise<IpcResult<AgentTurnRevertResult>> =>
      invoke(IPC_CHANNELS.AGENT_REVERT_TURN, turnId),
    summarizeTitle: (request: AgentTitleSummaryRequest): Promise<IpcResult<string>> =>
      invoke(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE, request),
    testMcp: (server: AgentMcpServerConfig): Promise<IpcResult<McpServerTestResult>> =>
      invoke(IPC_CHANNELS.AGENT_TEST_MCP, server)
  },

  agentRuntime: {
    getSnapshot: (): Promise<IpcResult<AgentRuntimeSnapshot>> =>
      invoke(IPC_CHANNELS.AGENT_RUNTIME_GET_SNAPSHOT),
    enqueue: (input: AgentRuntimeQueueInput): Promise<IpcResult<AgentRuntimeQueueItem>> =>
      invoke(IPC_CHANNELS.AGENT_RUNTIME_ENQUEUE, input),
    updateEvent: (input: AgentRuntimeQueueUpdateInput): Promise<IpcResult<AgentRuntimeQueueItem | null>> =>
      invoke(IPC_CHANNELS.AGENT_RUNTIME_UPDATE_EVENT, input),
    buildContext: (input: AgentRuntimeContextBuildInput): Promise<IpcResult<AgentRuntimeContextBuildResult>> =>
      invoke(IPC_CHANNELS.AGENT_RUNTIME_BUILD_CONTEXT, input),
    selectTools: (text: string): Promise<IpcResult<AgentRuntimeToolRegistryItem[]>> =>
      invoke(IPC_CHANNELS.AGENT_RUNTIME_SELECT_TOOLS, text),
    onSnapshot: (handler: (snapshot: AgentRuntimeSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: AgentRuntimeSnapshot) => handler(snapshot)
      ipcRenderer.on(IPC_CHANNELS.AGENT_RUNTIME_SNAPSHOT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_RUNTIME_SNAPSHOT, listener)
    }
  },


  settings: {
    get: (): Promise<IpcResult<SettingsData>> => invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (partial: Partial<SettingsData>): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.SETTINGS_SET, partial),
    testProvider: (provider: import('../shared/types/ai.js').AIProviderConfig): Promise<IpcResult<{ ok: boolean; message: string }>> =>
      invoke(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, provider),
    getProjectProvider: (rootPath: string): Promise<IpcResult<string | null>> =>
      invoke(IPC_CHANNELS.SETTINGS_GET_PROJECT_PROVIDER, rootPath),
    setProjectProvider: (rootPath: string, providerId: string | null): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.SETTINGS_SET_PROJECT_PROVIDER, rootPath, providerId),
    probeModelCapabilities: (
      provider: import('../shared/types/ai.js').AIProviderConfig,
      model: string
    ): Promise<IpcResult<import('../shared/types/ai.js').ModelCapabilityProfile>> =>
      invoke(IPC_CHANNELS.SETTINGS_PROBE_MODEL_CAPABILITIES, provider, model),
    listProviderModels: (provider: import('../shared/types/ai.js').AIProviderConfig): Promise<IpcResult<ProviderModelListResult>> =>
      invoke(IPC_CHANNELS.SETTINGS_LIST_PROVIDER_MODELS, provider)
  },

  sandbox: {
    getStatus: (): Promise<IpcResult<import('../shared/types/sandbox.js').SandboxStatus>> =>
      invoke(IPC_CHANNELS.SANDBOX_GET_STATUS)
  },

  ai: {
    inlineComplete: (request: AIInlineCompletionRequest): Promise<IpcResult<AIInlineCompletionResult>> =>
      invoke(IPC_CHANNELS.AI_INLINE_COMPLETE, request),
    cancelInline: (requestId: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.AI_INLINE_CANCEL, requestId),
    inlineEdit: (request: AIInlineEditRequest): Promise<IpcResult<AIInlineEditResult>> =>
      invoke(IPC_CHANNELS.AI_INLINE_EDIT, request)
  },

  memory: {
    list: (options?: MemoryListOptions): Promise<IpcResult<AgentMemory[]>> =>
      invoke(IPC_CHANNELS.MEMORY_LIST, options),
    count: (): Promise<IpcResult<number>> => invoke(IPC_CHANNELS.MEMORY_COUNT),
    reset: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.MEMORY_RESET),
    capture: (request: MemoryCaptureRequest): Promise<IpcResult<string | null>> =>
      invoke(IPC_CHANNELS.MEMORY_CAPTURE, request),
    create: (input: MemoryCreateInput): Promise<IpcResult<AgentMemory>> =>
      invoke(IPC_CHANNELS.MEMORY_CREATE, input),
    archive: (id: string): Promise<IpcResult<AgentMemory | null>> =>
      invoke(IPC_CHANNELS.MEMORY_ARCHIVE, id),
    delete: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.MEMORY_DELETE, id)
  },

  chronicle: {
    getSnapshot: (excludeSessionId?: string): Promise<IpcResult<import('../shared/types/chronicle.js').ChronicleSnapshot>> =>
      invoke(IPC_CHANNELS.CHRONICLE_GET_SNAPSHOT, excludeSessionId)
  },

  scheduledTasks: {
    list: (options?: ScheduledTaskListOptions): Promise<IpcResult<ScheduledTask[]>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_LIST, options),
    templates: (query?: string): Promise<IpcResult<ScheduledTaskTemplate[]>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_TEMPLATES, query),
    create: (input: CreateScheduledTaskInput): Promise<IpcResult<ScheduledTask>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_CREATE, input),
    createFromTemplate: (templateId: string, overrides?: Partial<CreateScheduledTaskInput>): Promise<IpcResult<ScheduledTask>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_CREATE_FROM_TEMPLATE, templateId, overrides),
    update: (input: UpdateScheduledTaskInput): Promise<IpcResult<ScheduledTask | null>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_UPDATE, input),
    runNow: (id: string): Promise<IpcResult<ScheduledTask | null>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_RUN_NOW, id),
    markRun: (input: MarkScheduledTaskRunInput): Promise<IpcResult<ScheduledTask | null>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_MARK_RUN, input),
    listRuns: (id: string, limit?: number): Promise<IpcResult<ScheduledTaskRun[]>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_LIST_RUNS, id, limit),
    dismissPending: (id: string): Promise<IpcResult<ScheduledTask | null>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_DISMISS_PENDING, id),
    archive: (id: string): Promise<IpcResult<ScheduledTask | null>> =>
      invoke(IPC_CHANNELS.SCHEDULED_TASKS_ARCHIVE, id),
    onFired: (handler: (event: ScheduledTaskFiredEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: ScheduledTaskFiredEvent) => handler(payload)
      ipcRenderer.on(IPC_CHANNELS.SCHEDULED_TASKS_FIRED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCHEDULED_TASKS_FIRED, listener)
    },
    onOpen: (handler: (taskId: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, taskId: string) => handler(taskId)
      ipcRenderer.on(IPC_CHANNELS.SCHEDULED_TASKS_OPEN, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCHEDULED_TASKS_OPEN, listener)
    }
  },

  browser: {
    listBookmarks: (): Promise<IpcResult<import('../shared/types/browser.js').BrowserBookmark[]>> =>
      invoke(IPC_CHANNELS.BROWSER_LIST_BOOKMARKS),
    addBookmark: (url: string, title: string): Promise<IpcResult<import('../shared/types/browser.js').BrowserBookmark>> =>
      invoke(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, url, title),
    removeBookmark: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, id),
    isBookmarked: (url: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.BROWSER_IS_BOOKMARKED, url),
    recordHistory: (url: string, title: string): Promise<IpcResult<import('../shared/types/browser.js').BrowserHistoryEntry>> =>
      invoke(IPC_CHANNELS.BROWSER_RECORD_HISTORY, url, title),
    listHistory: (limit?: number): Promise<IpcResult<import('../shared/types/browser.js').BrowserHistoryEntry[]>> =>
      invoke(IPC_CHANNELS.BROWSER_LIST_HISTORY, limit),
    removeHistory: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.BROWSER_REMOVE_HISTORY, id),
    clearHistory: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.BROWSER_CLEAR_HISTORY),
    clearHistoryRange: (range: import('../shared/types/browser.js').BrowserHistoryClearRange): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_CLEAR_HISTORY_RANGE, range),
    listDownloads: (): Promise<IpcResult<import('../shared/types/browser.js').BrowserDownload[]>> =>
      invoke(IPC_CHANNELS.BROWSER_LIST_DOWNLOADS),
    removeDownload: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.BROWSER_REMOVE_DOWNLOAD, id),
    clearDownloads: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS),
    clearBrowsingData: (): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.BROWSER_CLEAR_DATA),
    listPageMonitors: (): Promise<IpcResult<import('../shared/types/browser.js').BrowserPageMonitor[]>> =>
      invoke(IPC_CHANNELS.BROWSER_MONITOR_LIST),
    createPageMonitor: (url: string, title?: string, intervalMinutes?: number, aiAnalyze?: boolean): Promise<IpcResult<import('../shared/types/browser.js').BrowserPageMonitor>> =>
      invoke(IPC_CHANNELS.BROWSER_MONITOR_CREATE, url, title, intervalMinutes, aiAnalyze),
    setPageMonitorStatus: (id: string, status: 'active' | 'paused'): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_MONITOR_SET_STATUS, id, status),
    removePageMonitor: (id: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_MONITOR_REMOVE, id),
    listSitePermissions: (): Promise<IpcResult<Record<string, Record<string, 'allow' | 'deny'>>>> =>
      invoke(IPC_CHANNELS.BROWSER_SITE_PERMISSIONS_LIST),
    clearSitePermissions: (origin?: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_SITE_PERMISSIONS_CLEAR, origin),
    listAgentSitePolicies: (): Promise<IpcResult<Record<string, 'auto' | 'ask' | 'block'>>> =>
      invoke(IPC_CHANNELS.BROWSER_AGENT_POLICIES_LIST),
    setAgentSitePolicy: (origin: string, policy: 'auto' | 'ask' | 'block'): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_AGENT_POLICY_SET, origin, policy),
    setActiveWebContents: (id: number | null): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.BROWSER_SET_ACTIVE_WC, id),
    syncTabs: (
      tabs: Array<{ tabId: string; webContentsId: number; url: string; title: string; active: boolean }>
    ): Promise<IpcResult<void>> => invoke(IPC_CHANNELS.BROWSER_SYNC_TABS, tabs),
    onDownloadsChanged: (handler: (downloads: import('../shared/types/browser.js').BrowserDownload[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, downloads: import('../shared/types/browser.js').BrowserDownload[]) => {
        handler(downloads)
      }
      ipcRenderer.on(IPC_CHANNELS.BROWSER_DOWNLOADS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_DOWNLOADS_CHANGED, listener)
    },
    onOpenUrl: (handler: (url: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, url: string) => {
        handler(url)
      }
      ipcRenderer.on(IPC_CHANNELS.BROWSER_OPEN_URL, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_OPEN_URL, listener)
    },
    onOpenUrlInNewTab: (handler: (url: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, url: string) => {
        handler(url)
      }
      ipcRenderer.on(IPC_CHANNELS.BROWSER_OPEN_URL_IN_NEW_TAB, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_OPEN_URL_IN_NEW_TAB, listener)
    }
  },

  conversation: {
    listSessions: (options?: import('../shared/types/conversation.js').SessionListOptions): Promise<IpcResult<SessionSummary[]>> =>
      invoke(IPC_CHANNELS.CONVERSATION_LIST_SESSIONS, options),
    searchSessions: (query: string): Promise<IpcResult<SessionSummary[]>> =>
      invoke(IPC_CHANNELS.CONVERSATION_SEARCH_SESSIONS, query),
    getSession: (id: string): Promise<IpcResult<SessionDetail | null>> =>
      invoke(IPC_CHANNELS.CONVERSATION_GET_SESSION, id),
    createSession: (input: CreateSessionInput): Promise<IpcResult<SessionSummary>> =>
      invoke(IPC_CHANNELS.CONVERSATION_CREATE_SESSION, input),
    updateSession: (id: string, input: UpdateSessionInput): Promise<IpcResult<SessionSummary | null>> =>
      invoke(IPC_CHANNELS.CONVERSATION_UPDATE_SESSION, id, input),
    deleteSession: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.CONVERSATION_DELETE_SESSION, id),
    replaceMessages: (sessionId: string, messages: ChatMessage[]): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.CONVERSATION_REPLACE_MESSAGES, sessionId, messages),
    appendMessage: (sessionId: string, message: ChatMessage): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.CONVERSATION_APPEND_MESSAGE, sessionId, message),
    upsertMessage: (sessionId: string, message: ChatMessage): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.CONVERSATION_UPSERT_MESSAGE, sessionId, message),
    recoverStreaming: (sessionId: string): Promise<IpcResult<ChatMessage[]>> =>
      invoke(IPC_CHANNELS.CONVERSATION_RECOVER_STREAMING, sessionId),
    listProjects: (): Promise<IpcResult<ProjectEntry[]>> =>
      invoke(IPC_CHANNELS.CONVERSATION_LIST_PROJECTS),
    upsertProject: (entry: ProjectEntry): Promise<IpcResult<ProjectEntry>> =>
      invoke(IPC_CHANNELS.CONVERSATION_UPSERT_PROJECT, entry),
    removeProject: (id: string): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.CONVERSATION_REMOVE_PROJECT, id),
    getState: (): Promise<IpcResult<ConversationState>> =>
      invoke(IPC_CHANNELS.CONVERSATION_GET_STATE),
    setState: (partial: Partial<ConversationState>): Promise<IpcResult<ConversationState>> =>
      invoke(IPC_CHANNELS.CONVERSATION_SET_STATE, partial),
    importLegacy: (payload: LegacyConversationImport): Promise<IpcResult<LegacyImportResult>> =>
      invoke(IPC_CHANNELS.CONVERSATION_IMPORT_LEGACY, payload),
    getCodeAgentState: (): Promise<IpcResult<import('../shared/types/code-agent.js').PersistedCodeAgentState | null>> =>
      invoke(IPC_CHANNELS.CONVERSATION_GET_CODE_AGENT_STATE),
    setCodeAgentState: (state: import('../shared/types/code-agent.js').PersistedCodeAgentState): Promise<IpcResult<boolean>> =>
      invoke(IPC_CHANNELS.CONVERSATION_SET_CODE_AGENT_STATE, state)
  },

  lsp: {
    start: (request: import('../shared/types/lsp.js').LspStartRequest): Promise<IpcResult<import('../shared/types/lsp.js').LspStartResult>> =>
      invokeLsp('start', IPC_CHANNELS.LSP_START, request),
    stop: (languageId: string): Promise<IpcResult<void>> =>
      invokeLsp('stop', IPC_CHANNELS.LSP_STOP, languageId),
    documentOpen: (request: import('../shared/types/lsp.js').LspDocumentSyncRequest): Promise<IpcResult<void>> =>
      invokeLsp('documentOpen', IPC_CHANNELS.LSP_DOCUMENT_OPEN, request),
    documentChange: (request: import('../shared/types/lsp.js').LspDocumentSyncRequest): Promise<IpcResult<void>> =>
      invokeLsp('documentChange', IPC_CHANNELS.LSP_DOCUMENT_CHANGE, request),
    documentClose: (request: import('../shared/types/lsp.js').LspDocumentSyncRequest): Promise<IpcResult<void>> =>
      invokeLsp('documentClose', IPC_CHANNELS.LSP_DOCUMENT_CLOSE, request),
    hover: (request: import('../shared/types/lsp.js').LspPositionRequest): Promise<IpcResult<unknown>> =>
      invokeLsp('hover', IPC_CHANNELS.LSP_HOVER, request),
    definition: (request: import('../shared/types/lsp.js').LspPositionRequest): Promise<IpcResult<unknown>> =>
      invokeLsp('definition', IPC_CHANNELS.LSP_DEFINITION, request),
    codeAction: (request: import('../shared/types/lsp.js').LspCodeActionRequest): Promise<IpcResult<unknown>> =>
      invokeLsp('codeAction', IPC_CHANNELS.LSP_CODE_ACTION, request),
    request: (request: import('../shared/types/lsp.js').LspRequestPayload): Promise<IpcResult<unknown>> =>
      invokeLsp('request', IPC_CHANNELS.LSP_REQUEST, request),
    status: (languageId: string): Promise<IpcResult<import('../shared/types/lsp.js').LspLanguageSupport>> =>
      invokeLsp('status', IPC_CHANNELS.LSP_STATUS, languageId),
    onDiagnostics: (
      handler: (payload: import('../shared/types/lsp.js').LspDiagnosticsPayload) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: import('../shared/types/lsp.js').LspDiagnosticsPayload
      ) => {
        lspLog('preload', 'diagnostics event', {
          languageId: payload.languageId,
          path: shortLspPath(payload.path),
          count: payload.diagnostics.length
        })
        handler(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.LSP_DIAGNOSTICS, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LSP_DIAGNOSTICS, listener)
    },
    onApplyEdit: (
      handler: (payload: { languageId: string; edit: unknown }) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { languageId: string; edit: unknown }
      ) => {
        lspLog('preload', 'applyEdit event', { languageId: payload.languageId })
        handler(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.LSP_APPLY_EDIT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LSP_APPLY_EDIT, listener)
    }
  },

  formatter: {
    format: (request: import('../shared/types/ipc.js').FormatFileRequest): Promise<IpcResult<import('../shared/types/ipc.js').FormatFileResult>> =>
      invoke(IPC_CHANNELS.FORMATTER_FORMAT, request)
  },

  extension: {
    listInstalled: (): Promise<IpcResult<import('../shared/types/extension.js').ExtensionManifestSummary[]>> =>
      invoke(IPC_CHANNELS.EXTENSION_LIST_INSTALLED),
    getRecommendations: (): Promise<IpcResult<import('../shared/types/extension.js').ExtensionRecommendations>> =>
      invoke(IPC_CHANNELS.EXTENSION_GET_RECOMMENDATIONS),
    installFromFolder: (path: string): Promise<IpcResult<ExtensionInstallResult>> =>
      invoke(IPC_CHANNELS.EXTENSION_INSTALL_FROM_FOLDER, path),
    searchMarketplace: (query: string, size?: number): Promise<IpcResult<import('../shared/types/extension.js').MarketplaceExtension[]>> =>
      invoke(IPC_CHANNELS.EXTENSION_SEARCH_MARKETPLACE, query, size),
    installFromMarketplace: (namespace: string, name: string, version?: string): Promise<IpcResult<ExtensionInstallResult>> =>
      invoke(IPC_CHANNELS.EXTENSION_INSTALL_FROM_MARKETPLACE, namespace, name, version),
    readReadme: (extensionId: string): Promise<IpcResult<string>> =>
      invoke(IPC_CHANNELS.EXTENSION_READ_README, extensionId),
    uninstall: (extensionId: string): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.EXTENSION_UNINSTALL, extensionId),
    setEnabled: (extensionId: string, enabled: boolean): Promise<IpcResult<void>> =>
      invoke(IPC_CHANNELS.EXTENSION_SET_ENABLED, extensionId, enabled),
    activateContributions: (workspaceRoot?: string): Promise<IpcResult<import('../shared/types/extension.js').ExtensionActivationResult>> =>
      invoke(IPC_CHANNELS.EXTENSION_ACTIVATE_CONTRIBUTIONS, workspaceRoot),
    executeCommand: (command: string, args?: unknown[]): Promise<IpcResult<unknown>> =>
      invoke(IPC_CHANNELS.EXTENSION_EXECUTE_COMMAND, command, args ?? []),
    listCommands: (): Promise<IpcResult<string[]>> =>
      invoke(IPC_CHANNELS.EXTENSION_LIST_COMMANDS)
  }
}

contextBridge.exposeInMainWorld('luckyAI', api)

export type LuckyAIBridge = typeof api
