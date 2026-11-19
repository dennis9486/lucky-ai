/** IPC 通道白名单 — 所有 renderer ↔ main 通信必须在此注册 */
export const IPC_CHANNELS = {
  // App
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_OPEN_PATH: 'app:open-path',
  APP_SHOW_ITEM_IN_FOLDER: 'app:show-item-in-folder',
  APP_OPEN_FOLDER_DIALOG: 'app:open-folder-dialog',
  APP_OPEN_ATTACHMENT_DIALOG: 'app:open-attachment-dialog',
  APP_SAVE_PASTED_IMAGE: 'app:save-pasted-image',
  APP_SAVE_TEXT_FILE: 'app:save-text-file',
  DIAGNOSTICS_REPORT_ERROR: 'diagnostics:report-error',
  APP_MENU_COMMAND: 'app:menu-command',
  CHAT_SEND_PROMPT: 'chat:send-prompt',

  // Workspace
  WORKSPACE_SET: 'workspace:set',
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_GET_TREE: 'workspace:get-tree',
  WORKSPACE_SEARCH_FILES: 'workspace:search-files',
  WORKSPACE_SEARCH_CONTENT: 'workspace:search-content',
  WORKSPACE_REPLACE_CONTENT: 'workspace:replace-content',
  WORKSPACE_GET_EDITOR_STATE: 'workspace:get-editor-state',
  WORKSPACE_SET_EDITOR_STATE: 'workspace:set-editor-state',
  WORKSPACE_GIT_CHANGED: 'workspace:git-changed',
  WORKSPACE_GET_GIT_BRANCH: 'workspace:get-git-branch',
  WORKSPACE_GET_GIT_STATUS: 'workspace:get-git-status',
  WORKSPACE_LIST_GIT_BRANCHES: 'workspace:list-git-branches',
  WORKSPACE_CHECKOUT_GIT_BRANCH: 'workspace:checkout-git-branch',
  WORKSPACE_CREATE_GIT_BRANCH: 'workspace:create-git-branch',
  WORKSPACE_GET_GIT_FILE_DIFF: 'workspace:get-git-file-diff',
  WORKSPACE_GET_GIT_FILE_HUNKS: 'workspace:get-git-file-hunks',
  WORKSPACE_STAGE_GIT_FILE: 'workspace:stage-git-file',
  WORKSPACE_DISCARD_GIT_FILE: 'workspace:discard-git-file',
  WORKSPACE_SUGGEST_COMMIT_MESSAGE: 'workspace:suggest-commit-message',
  WORKSPACE_REVIEW_GIT_CHANGES: 'workspace:review-git-changes',
  WORKSPACE_COMMIT_ALL: 'workspace:commit-all',
  WORKSPACE_COMMIT_STAGED: 'workspace:commit-staged',
  WORKSPACE_LIST_GIT_STASHES: 'workspace:list-git-stashes',
  WORKSPACE_PUSH_GIT_STASH: 'workspace:push-git-stash',
  WORKSPACE_APPLY_GIT_STASH: 'workspace:apply-git-stash',
  WORKSPACE_DROP_GIT_STASH: 'workspace:drop-git-stash',
  WORKSPACE_UNSTAGE_GIT_FILE: 'workspace:unstage-git-file',
  WORKSPACE_STAGE_GIT_HUNK: 'workspace:stage-git-hunk',
  WORKSPACE_UNSTAGE_GIT_HUNK: 'workspace:unstage-git-hunk',
  WORKSPACE_PUSH_GIT: 'workspace:push-git',
  WORKSPACE_PULL_GIT: 'workspace:pull-git',
  WORKSPACE_FETCH_GIT: 'workspace:fetch-git',
  WORKSPACE_GET_GIT_CONFLICT_FILE: 'workspace:get-git-conflict-file',
  WORKSPACE_RESOLVE_GIT_CONFLICT_FILE: 'workspace:resolve-git-conflict-file',
  WORKSPACE_LIST_GIT_GRAPH: 'workspace:list-git-graph',

  // Extensions
  EXTENSION_LIST_INSTALLED: 'extension:list-installed',
  EXTENSION_GET_RECOMMENDATIONS: 'extension:get-recommendations',
  EXTENSION_INSTALL_FROM_FOLDER: 'extension:install-from-folder',
  EXTENSION_SEARCH_MARKETPLACE: 'extension:search-marketplace',
  EXTENSION_INSTALL_FROM_MARKETPLACE: 'extension:install-from-marketplace',
  EXTENSION_READ_README: 'extension:read-readme',
  EXTENSION_UNINSTALL: 'extension:uninstall',
  EXTENSION_SET_ENABLED: 'extension:set-enabled',
  EXTENSION_ACTIVATE_CONTRIBUTIONS: 'extension:activate-contributions',
  EXTENSION_EXECUTE_COMMAND: 'extension:execute-command',
  EXTENSION_LIST_COMMANDS: 'extension:list-commands',

  // Formatter
  FORMATTER_FORMAT: 'formatter:format',

  // File
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_DELETE: 'file:delete',
  FILE_CREATE: 'file:create',
  FILE_RENAME: 'file:rename',
  FILE_EXISTS: 'file:exists',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_RUN_COMMAND: 'terminal:run-command',
  TERMINAL_GET_OUTPUT: 'terminal:get-output',
  TERMINAL_DATA: 'terminal:data',

  // Agent (AgentScope)
  AGENT_SEND: 'agent:send',
  AGENT_EVENT: 'agent:event',
  AGENT_CONFIRM: 'agent:confirm',
  AGENT_CONFIRM_ALL: 'agent:confirm-all',
  AGENT_ABORT: 'agent:abort',
  AGENT_RESET: 'agent:reset',
  AGENT_TEST_MCP: 'agent:test-mcp',
  AGENT_SUMMARIZE_TITLE: 'agent:summarize-title',
  AGENT_RESET_CONVERSATION: 'agent:reset-conversation',
  AGENT_GET_USAGE_SUMMARY: 'agent:get-usage-summary',
  AGENT_LIST_TURN_CHECKPOINTS: 'agent:list-turn-checkpoints',
  AGENT_REVERT_TURN: 'agent:revert-turn',

  // Agent runtime / Brain
  AGENT_RUNTIME_GET_SNAPSHOT: 'agent-runtime:get-snapshot',
  AGENT_RUNTIME_ENQUEUE: 'agent-runtime:enqueue',
  AGENT_RUNTIME_UPDATE_EVENT: 'agent-runtime:update-event',
  AGENT_RUNTIME_BUILD_CONTEXT: 'agent-runtime:build-context',
  AGENT_RUNTIME_SELECT_TOOLS: 'agent-runtime:select-tools',
  AGENT_RUNTIME_SNAPSHOT: 'agent-runtime:snapshot',


  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_TEST_PROVIDER: 'settings:test-provider',
  SETTINGS_LIST_PROVIDER_MODELS: 'settings:list-provider-models',
  SETTINGS_PROBE_MODEL_CAPABILITIES: 'settings:probe-model-capabilities',
  SETTINGS_GET_PROJECT_PROVIDER: 'settings:get-project-provider',
  SETTINGS_SET_PROJECT_PROVIDER: 'settings:set-project-provider',
  // Sandbox
  SANDBOX_GET_STATUS: 'sandbox:get-status',
  AI_INLINE_COMPLETE: 'ai:inline-complete',
  AI_INLINE_CANCEL: 'ai:inline-cancel',
  AI_INLINE_EDIT: 'ai:inline-edit',

  // Memory
  MEMORY_LIST: 'memory:list',
  MEMORY_COUNT: 'memory:count',
  MEMORY_RESET: 'memory:reset',
  MEMORY_CAPTURE: 'memory:capture',
  MEMORY_CREATE: 'memory:create',
  MEMORY_ARCHIVE: 'memory:archive',
  MEMORY_DELETE: 'memory:delete',

  // Chronicle
  CHRONICLE_GET_SNAPSHOT: 'chronicle:get-snapshot',

  // Scheduled tasks
  SCHEDULED_TASKS_LIST: 'scheduled-tasks:list',
  SCHEDULED_TASKS_TEMPLATES: 'scheduled-tasks:templates',
  SCHEDULED_TASKS_CREATE: 'scheduled-tasks:create',
  SCHEDULED_TASKS_CREATE_FROM_TEMPLATE: 'scheduled-tasks:create-from-template',
  SCHEDULED_TASKS_UPDATE: 'scheduled-tasks:update',
  SCHEDULED_TASKS_RUN_NOW: 'scheduled-tasks:run-now',
  SCHEDULED_TASKS_MARK_RUN: 'scheduled-tasks:mark-run',
  SCHEDULED_TASKS_LIST_RUNS: 'scheduled-tasks:list-runs',
  SCHEDULED_TASKS_DISMISS_PENDING: 'scheduled-tasks:dismiss-pending',
  SCHEDULED_TASKS_ARCHIVE: 'scheduled-tasks:archive',
  /** main → renderer：某任务到点触发 */
  SCHEDULED_TASKS_FIRED: 'scheduled-tasks:fired',
  /** main → renderer：请求打开“已安排”并定位到某任务（原生通知点击） */
  SCHEDULED_TASKS_OPEN: 'scheduled-tasks:open',

  // Browser data
  BROWSER_LIST_BOOKMARKS: 'browser:list-bookmarks',
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_IS_BOOKMARKED: 'browser:is-bookmarked',
  BROWSER_RECORD_HISTORY: 'browser:record-history',
  BROWSER_LIST_HISTORY: 'browser:list-history',
  BROWSER_REMOVE_HISTORY: 'browser:remove-history',
  BROWSER_CLEAR_HISTORY: 'browser:clear-history',
  BROWSER_CLEAR_HISTORY_RANGE: 'browser:clear-history-range',
  BROWSER_LIST_DOWNLOADS: 'browser:list-downloads',
  BROWSER_REMOVE_DOWNLOAD: 'browser:remove-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',
  BROWSER_DOWNLOADS_CHANGED: 'browser:downloads-changed',
  BROWSER_CLEAR_DATA: 'browser:clear-data',
  BROWSER_MONITOR_LIST: 'browser:monitor-list',
  BROWSER_MONITOR_CREATE: 'browser:monitor-create',
  BROWSER_MONITOR_SET_STATUS: 'browser:monitor-set-status',
  BROWSER_MONITOR_REMOVE: 'browser:monitor-remove',
  BROWSER_SITE_PERMISSIONS_LIST: 'browser:site-permissions-list',
  BROWSER_SITE_PERMISSIONS_CLEAR: 'browser:site-permissions-clear',
  BROWSER_AGENT_POLICIES_LIST: 'browser:agent-policies-list',
  BROWSER_AGENT_POLICY_SET: 'browser:agent-policy-set',
  /** renderer → main：上报当前活动标签的 guest webContentsId，供 Agent 控制浏览器 */
  BROWSER_SET_ACTIVE_WC: 'browser:set-active-wc',
  /** renderer → main：全量同步标签映射（tabId → webContentsId），供 Agent 按标签寻址 */
  BROWSER_SYNC_TABS: 'browser:sync-tabs',
  BROWSER_OPEN_URL: 'browser:open-url',
  /** main → renderer：webview 弹窗/target=_blank 请求，在新标签打开 */
  BROWSER_OPEN_URL_IN_NEW_TAB: 'browser:open-url-in-new-tab',

  // Conversation (SQLite)
  CONVERSATION_LIST_SESSIONS: 'conversation:list-sessions',
  CONVERSATION_SEARCH_SESSIONS: 'conversation:search-sessions',
  CONVERSATION_GET_SESSION: 'conversation:get-session',
  CONVERSATION_CREATE_SESSION: 'conversation:create-session',
  CONVERSATION_UPDATE_SESSION: 'conversation:update-session',
  CONVERSATION_DELETE_SESSION: 'conversation:delete-session',
  CONVERSATION_REPLACE_MESSAGES: 'conversation:replace-messages',
  CONVERSATION_APPEND_MESSAGE: 'conversation:append-message',
  CONVERSATION_UPSERT_MESSAGE: 'conversation:upsert-message',
  CONVERSATION_RECOVER_STREAMING: 'conversation:recover-streaming',
  CONVERSATION_LIST_PROJECTS: 'conversation:list-projects',
  CONVERSATION_UPSERT_PROJECT: 'conversation:upsert-project',
  CONVERSATION_REMOVE_PROJECT: 'conversation:remove-project',
  CONVERSATION_GET_STATE: 'conversation:get-state',
  CONVERSATION_SET_STATE: 'conversation:set-state',
  CONVERSATION_IMPORT_LEGACY: 'conversation:import-legacy',
  CONVERSATION_GET_CODE_AGENT_STATE: 'conversation:get-code-agent-state',
  CONVERSATION_SET_CODE_AGENT_STATE: 'conversation:set-code-agent-state',

  // LSP
  LSP_START: 'lsp:start',
  LSP_STOP: 'lsp:stop',
  LSP_DOCUMENT_OPEN: 'lsp:document-open',
  LSP_DOCUMENT_CHANGE: 'lsp:document-change',
  LSP_DOCUMENT_CLOSE: 'lsp:document-close',
  LSP_HOVER: 'lsp:hover',
  LSP_DEFINITION: 'lsp:definition',
  LSP_CODE_ACTION: 'lsp:code-action',
  LSP_REQUEST: 'lsp:request',
  LSP_DIAGNOSTICS: 'lsp:diagnostics',
  LSP_APPLY_EDIT: 'lsp:apply-edit',
  LSP_STATUS: 'lsp:status',

  // Window
  WINDOW_CREATE: 'window:create',
  /** main → renderer：窗口进入/退出原生全屏 */
  WINDOW_FULLSCREEN_CHANGED: 'window:fullscreen-changed',
  /** renderer → main：设置窗口全屏状态 */
  WINDOW_SET_FULLSCREEN: 'window:set-fullscreen',

  // Auto updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_GET_STATE: 'updater:get-state',
  /** main → renderer：推送更新状态变化 */
  UPDATER_STATUS: 'updater:status'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const ALLOWED_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS)

export function isAllowedChannel(channel: string): channel is IpcChannel {
  return (ALLOWED_IPC_CHANNELS as readonly string[]).includes(channel)
}
