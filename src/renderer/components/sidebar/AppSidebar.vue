<script setup lang="ts">
import { nextTick, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Search, Clock, Globe2, MessageCircle, Code2, FolderOpen, GitBranch, PlugZap, RefreshCw, Files, ChevronDown, CircleAlert } from 'lucide-vue-next'
import SidebarNavItem from './SidebarNavItem.vue'
import SidebarProjectGroup from './SidebarProjectGroup.vue'
import SidebarUserProfile from './SidebarUserProfile.vue'
import FileTree from '../file-tree/FileTree.vue'
import CodeSearchPanel from '../code/CodeSearchPanel.vue'
import CodeGitPanel from '../code/CodeGitPanel.vue'
import CodeExtensionsPanel from '../code/CodeExtensionsPanel.vue'
import CodeProblemsPanel from '../code/CodeProblemsPanel.vue'
import { useSessionStore } from '../../stores/session.store.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useWorkspaceStore } from '../../stores/workspace.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useScheduledTaskStore } from '../../stores/scheduled-task.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { conversation } from '../../services/conversation-client.js'
import {
  buildSessionMarkdown,
  sessionMarkdownFileName,
  type SessionMarkdownLabels
} from '../../utils/session-export.js'
import type { SidebarProjectGroup as SidebarProjectGroupModel } from '../../../shared/types/session.js'

const { t, locale } = useI18n()
const sessions = useSessionStore()
const chat = useChatStore()
const ui = useUiStore()
const projects = useProjectStore()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const scheduledTasks = useScheduledTaskStore()
const activeCodeTab = computed({
  get: () => ui.codeSidebarTab,
  set: (value) => { ui.codeSidebarTab = value }
})
const isCodeMode = computed(() => ui.currentView === 'code')
const browserModeToggle = computed(() => {
  const isBrowser = ui.currentView === 'browser'
  return {
    icon: isBrowser ? MessageCircle : Globe2,
    label: isBrowser ? t('nav.chat') : t('nav.browser')
  }
})
const renameTargetId = ref<string | null>(null)
const renameTitle = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
const deleteTargetId = ref<string | null>(null)
const projectRenameTarget = ref<SidebarProjectGroupModel | null>(null)
const projectRenameName = ref('')
const projectRenameInputRef = ref<HTMLInputElement | null>(null)
const removeProjectTarget = ref<SidebarProjectGroupModel | null>(null)
const renameTarget = computed(() => sessions.summaries.find((s) => s.id === renameTargetId.value))
const deleteTarget = computed(() => sessions.summaries.find((s) => s.id === deleteTargetId.value))
const sortedProjectGroups = computed(() => {
  const pinned = new Set(projects.pinnedProjectIds)
  return [...sessions.projectGroups].sort((a, b) => {
    const ap = pinned.has(a.id) ? 1 : 0
    const bp = pinned.has(b.id) ? 1 : 0
    return bp - ap
  })
})

function handleNewChat(): void {
  chat.abortIfRunning()
  void sessions.newChat()
  chat.clearInput()
  ui.currentView = settings.general.defaultNoProjectChat ? 'chat' : 'home'
}

function switchMode(view: 'home' | 'chat' | 'code'): void {
  if (view === 'code') {
    if (!settings.professionalMode) return
    ui.currentView = 'code'
    void refreshCodeSidebar()
    return
  }
  ui.currentView = sessions.activeSession?.messages.length ? 'chat' : 'home'
}

function handleSearch(): void {
  ui.commandPaletteMode = 'sessions'
  ui.showCommandPalette = true
}

function handleBrowserToggle(): void {
  chat.abortIfRunning()
  if (ui.currentView === 'browser') {
    ui.currentView = sessions.activeSession?.messages.length ? 'chat' : 'home'
    return
  }
  ui.currentView = 'browser'
}

function handleScheduled(): void {
  chat.abortIfRunning()
  ui.currentView = 'scheduled'
}

async function handleSelectChat(id: string): Promise<void> {
  chat.abortIfRunning()
  const keepBrowserMode = ui.currentView === 'browser'
  const session = await sessions.selectSessionWithProject(id)
  if (!session) return
  if (keepBrowserMode) {
    ui.currentView = 'browser'
    return
  }
  ui.currentView = session.messages.length > 0 ? 'chat' : 'home'
}

async function handleRename(id: string): Promise<void> {
  const item = sessions.summaries.find((s) => s.id === id)
  renameTargetId.value = id
  renameTitle.value = item?.title ?? ''
  await nextTick()
  renameInputRef.value?.focus()
  renameInputRef.value?.select()
}

function closeRename(): void {
  renameTargetId.value = null
  renameTitle.value = ''
}

async function submitRename(): Promise<void> {
  if (!renameTargetId.value) return
  const next = renameTitle.value.trim()
  if (next) {
    await sessions.renameSession(renameTargetId.value, next)
  }
  closeRename()
}

async function handleDelete(id: string): Promise<void> {
  deleteTargetId.value = id
}

function closeDelete(): void {
  deleteTargetId.value = null
}

async function confirmDelete(): Promise<void> {
  if (!deleteTargetId.value) return
  const id = deleteTargetId.value
  closeDelete()
  chat.abortIfRunning()
  await sessions.deleteSession(id)
  if (!sessions.activeSessionId) ui.currentView = 'home'
}

async function handleArchive(id: string): Promise<void> {
  chat.abortIfRunning()
  await sessions.archiveSession(id)
  if (!sessions.activeSessionId) ui.currentView = 'home'
}

async function handleUnarchive(id: string): Promise<void> {
  await sessions.unarchiveSession(id)
}

function getExportLabels(): SessionMarkdownLabels {
  return {
    project: t('session.export.labels.project'),
    workspacePath: t('session.export.labels.workspacePath'),
    createdAt: t('session.export.labels.createdAt'),
    updatedAt: t('session.export.labels.updatedAt'),
    exportedAt: t('session.export.labels.exportedAt'),
    user: t('session.export.labels.user'),
    assistant: t('session.export.labels.assistant'),
    system: t('session.export.labels.system'),
    tool: t('session.export.labels.tool'),
    images: t('session.export.labels.images'),
    thinking: t('session.export.labels.thinking'),
    toolCall: t('session.export.labels.toolCall'),
    toolInput: t('session.export.labels.toolInput'),
    toolOutput: t('session.export.labels.toolOutput'),
    emptyMessage: t('session.export.labels.emptyMessage')
  }
}

async function handleExportMarkdown(id: string): Promise<void> {
  try {
    const session = await conversation.getSession(id)
    if (!session) {
      await ui.alert(t('session.export.failed', { error: t('session.export.notFound') }), t('session.export.markdown'))
      return
    }

    const content = buildSessionMarkdown(session, {
      locale: locale.value,
      labels: getExportLabels()
    })
    const savedPath = await unwrap<string | null>(ipc.app.saveTextFile({
      defaultPath: sessionMarkdownFileName(session),
      content,
      filters: [{ name: t('session.export.markdownFile'), extensions: ['md'] }]
    }))

    if (savedPath) {
      await ui.alert(t('session.export.success', { path: savedPath }), t('session.export.markdown'))
    }
  } catch (error) {
    await ui.alert(
      t('session.export.failed', { error: error instanceof Error ? error.message : String(error) }),
      t('session.export.markdown')
    )
  }
}

function findProjectIdForGroup(group: SidebarProjectGroupModel): string | null {
  if (group.workspacePath) {
    const match = projects.projects.find((project) => project.rootPath === group.workspacePath)
    return match?.id ?? group.workspacePath
  }
  return projects.projects.find((project) => project.name === group.name)?.id ?? null
}

async function handleActivateProject(group: SidebarProjectGroupModel): Promise<void> {
  if (group.workspacePath) {
    await projects.activateByPath(group.workspacePath)
  }
}

async function handleNewChatInProject(group: SidebarProjectGroupModel): Promise<void> {
  await handleActivateProject(group)
  handleNewChat()
}

function handlePinProject(group: SidebarProjectGroupModel): void {
  projects.togglePinProject(group.id)
}

async function handleRevealProject(group: SidebarProjectGroupModel): Promise<void> {
  const id = findProjectIdForGroup(group)
  if (id) {
    await projects.revealProject(id)
    return
  }
  if (group.workspacePath) {
    await unwrap(ipc.app.showItemInFolder(group.workspacePath))
  }
}

async function handleWorktreeProject(group: SidebarProjectGroupModel): Promise<void> {
  const id = findProjectIdForGroup(group)
  if (id) {
    await projects.createWorktreeForProject(id)
    return
  }
  if (group.workspacePath) {
    await projects.activateByPath(group.workspacePath)
    await projects.setStartupMode('worktree')
    await projects.addProjectFromDialog()
  }
}

async function handleRenameProject(group: SidebarProjectGroupModel): Promise<void> {
  projectRenameTarget.value = group
  projectRenameName.value = group.name
  await nextTick()
  projectRenameInputRef.value?.focus()
  projectRenameInputRef.value?.select()
}

function closeProjectRename(): void {
  projectRenameTarget.value = null
  projectRenameName.value = ''
}

async function submitProjectRename(): Promise<void> {
  if (!projectRenameTarget.value) return
  const id = findProjectIdForGroup(projectRenameTarget.value)
  const next = projectRenameName.value.trim()
  if (id && next) {
    await projects.renameProject(id, next)
  }
  closeProjectRename()
}

async function handleArchiveAllInProject(group: SidebarProjectGroupModel): Promise<void> {
  chat.abortIfRunning()
  for (const item of group.items) {
    if (!item.archived) await sessions.archiveSession(item.id)
  }
  if (!sessions.activeSessionId) ui.currentView = 'home'
}

function handleRemoveProject(group: SidebarProjectGroupModel): void {
  removeProjectTarget.value = group
}

function closeRemoveProject(): void {
  removeProjectTarget.value = null
}

async function confirmRemoveProject(): Promise<void> {
  if (!removeProjectTarget.value) return
  const id = findProjectIdForGroup(removeProjectTarget.value)
  closeRemoveProject()
  if (id) await projects.removeProject(id)
}

async function openProject(): Promise<void> {
  await projects.addProjectFromDialog()
  ui.currentView = 'code'
  await refreshCodeSidebar()
}

async function refreshCodeSidebar(): Promise<void> {
  if (!projects.hasWorkspace) return
  await Promise.all([
    workspace.refreshTree(),
    projects.refreshGitBranch()
  ])
}

watch(
  () => [ui.currentView, projects.activeProject?.rootPath] as const,
  ([view]) => {
    if (view === 'code') void refreshCodeSidebar()
  }
)

watch(
  () => [settings.loaded, settings.professionalMode] as const,
  ([loaded, enabled]) => {
    if (!loaded) return
    if (!enabled && ui.currentView === 'code') {
      ui.currentView = sessions.activeSession?.messages.length ? 'chat' : 'home'
    }
  },
  { immediate: true }
)
</script>

<template>
  <aside class="app-sidebar">
    <div v-if="settings.professionalMode" class="mode-tabs no-drag">
      <button
        type="button"
        class="mode-tab"
        :class="{ active: ui.currentView !== 'code' }"
        @click="switchMode('chat')"
      >
        <MessageCircle :size="15" />
        <span>{{ t('nav.chat') }}</span>
      </button>
      <button type="button" class="mode-tab" :class="{ active: ui.currentView === 'code' }" :title="t('nav.code')" @click="switchMode('code')">
        <Code2 :size="15" />
        <span>{{ t('nav.code') }}</span>
      </button>
    </div>

    <template v-if="!isCodeMode">
      <nav class="main-nav no-drag">
        <SidebarNavItem :icon="Plus" :label="t('nav.newChat')" @click="handleNewChat" />
        <SidebarNavItem :icon="Search" :label="t('nav.search')" @click="handleSearch" />
        <SidebarNavItem
          :icon="browserModeToggle.icon"
          :label="browserModeToggle.label"
          :active="ui.currentView === 'browser'"
          @click="handleBrowserToggle"
        />
        <SidebarNavItem :icon="Clock" :label="t('nav.scheduled')" :active="ui.currentView === 'scheduled'" :badge="scheduledTasks.pendingCount" @click="handleScheduled" />
        <!-- 聊天页「插件」系统未就绪，暂不展示入口（代码页的 VS Code 扩展在代码工作台「扩展」页） -->
      </nav>

      <div class="projects-section pretty-scrollbar no-drag">
        <div class="section-header">
          <div class="section-label">{{ t('nav.projects') }}</div>
          <button type="button" class="archive-toggle" @click="sessions.toggleShowArchived()">
            {{ sessions.showArchived ? t('nav.hideArchived') : t('nav.showArchived') }}
          </button>
        </div>
        <template v-if="sortedProjectGroups.length">
          <SidebarProjectGroup
            v-for="group in sortedProjectGroups"
            :key="group.id"
            :group="group"
            :active-chat-id="sessions.activeSessionId"
            :pinned="projects.isPinned(group.id)"
            @select="handleSelectChat"
            @rename="handleRename"
            @delete="handleDelete"
            @archive="handleArchive"
            @unarchive="handleUnarchive"
            @export-markdown="handleExportMarkdown"
            @activate="handleActivateProject"
            @new-chat="handleNewChatInProject"
            @pin="handlePinProject"
            @reveal="handleRevealProject"
            @worktree="handleWorktreeProject"
            @rename-project="handleRenameProject"
            @archive-all="handleArchiveAllInProject"
            @remove-project="handleRemoveProject"
          />
        </template>
        <p v-else class="empty-hint">{{ t('nav.emptyChats') }}</p>
      </div>
    </template>

    <template v-else>
      <section class="code-panel no-drag">
        <div class="code-tabs">
          <button
            type="button"
            class="code-tab-btn"
            :class="{ active: activeCodeTab === 'files' }"
            :title="t('code.files')"
            @click="activeCodeTab = 'files'"
          >
            <Files :size="15" />
          </button>
          <button
            type="button"
            class="code-tab-btn"
            :class="{ active: activeCodeTab === 'search' }"
            :title="t('code.searchFiles')"
            @click="activeCodeTab = 'search'"
          >
            <Search :size="15" />
          </button>
          <button
            type="button"
            class="code-tab-btn"
            :class="{ active: activeCodeTab === 'git' }"
            :title="t('code.git')"
            @click="activeCodeTab = 'git'"
          >
            <GitBranch :size="15" />
          </button>
          <button
            type="button"
            class="code-tab-btn"
            :class="{ active: activeCodeTab === 'extensions' }"
            :title="t('code.vscodeExtensions')"
            @click="activeCodeTab = 'extensions'"
          >
            <PlugZap :size="15" />
          </button>
          <button
            type="button"
            class="code-tab-btn"
            :class="{ active: activeCodeTab === 'problems' }"
            :title="t('lsp.problems')"
            @click="activeCodeTab = 'problems'"
          >
            <CircleAlert :size="15" />
          </button>
          <button type="button" class="code-tab-btn subtle" :title="t('code.openProject')" @click="openProject">
            <FolderOpen :size="14" />
          </button>
          <button type="button" class="code-tab-btn subtle" :title="t('code.refresh')" :disabled="workspace.loading" @click="refreshCodeSidebar">
            <RefreshCw :size="15" :class="{ spinning: workspace.loading }" />
          </button>
          <button type="button" class="code-tab-btn subtle" :title="t('titlebar.more')">
            <ChevronDown :size="16" />
          </button>
        </div>

        <div v-if="activeCodeTab === 'files'" class="code-tree-section pretty-scrollbar">
          <FileTree v-if="workspace.tree.length" :tree="workspace.tree" />
          <div v-else class="code-empty-tree">
            <FolderOpen :size="28" />
            <p>{{ projects.hasWorkspace ? t('code.emptyTree') : t('code.openProjectHint') }}</p>
            <button type="button" class="code-primary-btn" @click="openProject">{{ t('code.openProject') }}</button>
          </div>
        </div>

        <div v-else-if="activeCodeTab === 'search'" class="code-search-section">
          <CodeSearchPanel />
        </div>

        <div v-else-if="activeCodeTab === 'git'" class="code-git-section">
          <CodeGitPanel />
        </div>

        <div v-else-if="activeCodeTab === 'problems'" class="code-git-section">
          <CodeProblemsPanel />
        </div>

        <div v-else class="code-git-section">
          <CodeExtensionsPanel />
        </div>
      </section>
    </template>

    <div class="no-drag mt-auto">
      <SidebarUserProfile />
    </div>

    <Teleport to="body">
      <div v-if="renameTargetId" class="sidebar-dialog-backdrop no-drag" @click.self="closeRename">
        <form class="sidebar-dialog" @submit.prevent="submitRename" @keydown.esc.prevent="closeRename">
          <div class="dialog-title">{{ t('session.rename') }}</div>
          <input
            ref="renameInputRef"
            v-model="renameTitle"
            class="dialog-input"
            type="text"
            :placeholder="t('session.renamePlaceholder')"
          />
          <div class="dialog-actions">
            <button type="button" class="dialog-btn" @click="closeRename">{{ t('common.cancel') }}</button>
            <button type="submit" class="dialog-btn primary" :disabled="!renameTitle.trim() || renameTitle.trim() === renameTarget?.title">
              {{ t('common.save') }}
            </button>
          </div>
        </form>
      </div>

      <div v-if="deleteTargetId" class="sidebar-dialog-backdrop no-drag" @click.self="closeDelete">
        <div class="sidebar-dialog" role="dialog" aria-modal="true" @keydown.esc.prevent="closeDelete">
          <div class="dialog-title">{{ t('session.delete') }}</div>
          <p class="dialog-desc">{{ t('session.deleteConfirm') }}</p>
          <p v-if="deleteTarget" class="dialog-session-title">{{ deleteTarget.title }}</p>
          <div class="dialog-actions">
            <button type="button" class="dialog-btn" @click="closeDelete">{{ t('common.cancel') }}</button>
            <button type="button" class="dialog-btn danger" @click="confirmDelete">{{ t('session.delete') }}</button>
          </div>
        </div>
      </div>

      <div v-if="projectRenameTarget" class="sidebar-dialog-backdrop no-drag" @click.self="closeProjectRename">
        <form class="sidebar-dialog" @submit.prevent="submitProjectRename" @keydown.esc.prevent="closeProjectRename">
          <div class="dialog-title">{{ t('project.menu.rename') }}</div>
          <input
            ref="projectRenameInputRef"
            v-model="projectRenameName"
            class="dialog-input"
            type="text"
            :placeholder="t('project.renamePlaceholder')"
          />
          <div class="dialog-actions">
            <button type="button" class="dialog-btn" @click="closeProjectRename">{{ t('common.cancel') }}</button>
            <button type="submit" class="dialog-btn primary" :disabled="!projectRenameName.trim() || projectRenameName.trim() === projectRenameTarget?.name">
              {{ t('common.save') }}
            </button>
          </div>
        </form>
      </div>

      <div v-if="removeProjectTarget" class="sidebar-dialog-backdrop no-drag" @click.self="closeRemoveProject">
        <div class="sidebar-dialog" role="dialog" aria-modal="true" @keydown.esc.prevent="closeRemoveProject">
          <div class="dialog-title">{{ t('project.menu.remove') }}</div>
          <p class="dialog-desc">{{ t('project.removeConfirm') }}</p>
          <p v-if="removeProjectTarget" class="dialog-session-title">{{ removeProjectTarget.name }}</p>
          <div class="dialog-actions">
            <button type="button" class="dialog-btn" @click="closeRemoveProject">{{ t('common.cancel') }}</button>
            <button type="button" class="dialog-btn danger" @click="confirmRemoveProject">{{ t('project.menu.remove') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.app-sidebar {
  @apply min-w-[220px] shrink-0 flex flex-col h-full bg-codex-sidebar border-r border-codex-border;
}
.mode-tabs {
  @apply mx-3 mt-3 mb-2 grid grid-cols-2 gap-1 rounded-xl bg-codex-hover p-1;
}
.mode-tab {
  @apply flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium
         text-codex-muted transition-colors hover:text-codex-text;
}
.mode-tab.active {
  @apply bg-codex-bg text-codex-text shadow-sm;
}
.main-nav {
  @apply px-2 space-y-0.5 pb-3 pt-1;
}
.projects-section {
  @apply flex-1 min-h-0 overflow-y-auto px-2;
}
.section-header {
  @apply flex items-center justify-between px-2.5 py-1.5;
}
.section-label {
  @apply text-[12px] font-medium text-codex-muted;
}
.archive-toggle {
  @apply text-[11px] text-codex-muted hover:text-codex-text transition-colors;
}
.expand-btn {
  @apply w-full text-left px-2.5 py-1.5 text-[12px] text-codex-muted hover:text-codex-text transition-colors;
}
.empty-hint {
  @apply px-2.5 py-2 text-[12px] text-codex-muted;
}
.code-panel {
  @apply flex min-h-0 flex-1 flex-col;
}
.code-tabs {
  @apply flex h-10 shrink-0 items-center gap-1 border-b border-codex-border px-3;
}
.code-tab-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-text transition-colors
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-50;
}
.code-tab-btn.active {
  @apply bg-codex-hover text-codex-text shadow-sm;
}
.code-tab-btn.subtle {
  @apply text-codex-text-secondary hover:text-codex-text;
}
.code-tab-btn:nth-last-child(3) {
  @apply ml-auto;
}
.code-tree-section {
  @apply flex min-h-0 flex-1 flex-col overflow-hidden;
}
.code-search-section {
  @apply min-h-0 flex-1 overflow-hidden;
  height: 100%;
}
.code-git-section {
  @apply min-h-0 flex-1 overflow-hidden;
  height: 100%;
}
.code-empty-tree {
  @apply flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center text-[12px] leading-relaxed text-codex-muted;
}
.code-primary-btn {
  @apply rounded-lg bg-codex-text px-3 py-1.5 text-[12px] font-medium text-codex-bg transition-opacity hover:opacity-90;
}
.code-secondary-btn {
  @apply rounded-lg border border-codex-border bg-codex-bg px-3 py-1.5 text-[12px] font-medium text-codex-text-secondary
         transition-colors hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-50;
}
.code-tool-panel {
  @apply flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-codex-muted;
}
.code-tool-panel h3 {
  @apply text-[14px] font-semibold text-codex-text;
}
.code-tool-panel p {
  @apply max-w-[220px] text-[12px] leading-relaxed;
}
.vscode-section {
  @apply min-h-0 flex-1 overflow-auto p-4;
}
.vscode-title {
  @apply flex items-center gap-2 text-[13px] font-semibold text-codex-text;
}
.vscode-section p,
.extension-empty {
  @apply mt-1.5 text-[11px] leading-relaxed text-codex-muted;
}
.extension-list {
  @apply mt-2 space-y-1;
}
.extension-label {
  @apply text-[11px] font-medium text-codex-muted;
}
.extension-item {
  @apply truncate rounded-md bg-codex-hover px-2 py-1 text-[11px] font-medium text-codex-text-secondary;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.no-drag { -webkit-app-region: no-drag; }
.sidebar-dialog-backdrop {
  @apply fixed inset-0 z-50 flex items-center justify-center bg-black/10 px-4;
}
.sidebar-dialog {
  @apply w-[340px] rounded-xl border border-codex-border bg-codex-bg p-4 shadow-xl;
}
.dialog-title {
  @apply text-[14px] font-semibold text-codex-text;
}
.dialog-desc {
  @apply mt-2 text-[12px] leading-relaxed text-codex-text-secondary;
}
.dialog-session-title {
  @apply mt-2 truncate rounded-lg bg-codex-hover px-3 py-2 text-[12px] text-codex-text;
}
.dialog-input {
  @apply mt-3 w-full rounded-lg border border-codex-border bg-codex-bg px-3 py-2 text-[13px]
         text-codex-text outline-none transition-colors focus:border-codex-text-secondary;
}
.dialog-actions {
  @apply mt-4 flex justify-end gap-2;
}
.dialog-btn {
  @apply rounded-lg px-3 py-1.5 text-[12px] font-medium text-codex-text-secondary
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-40;
}
.dialog-btn.primary {
  @apply bg-codex-text text-codex-bg hover:bg-codex-text hover:text-codex-bg;
}
.dialog-btn.danger {
  @apply bg-red-500 text-white hover:bg-red-600 hover:text-white;
}
</style>
