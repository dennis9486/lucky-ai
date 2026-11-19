<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import LoginView from './components/auth/LoginView.vue'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import AppTitleBar from './components/common/AppTitleBar.vue'
import HomeView from './components/home/HomeView.vue'
import ChatView from './components/home/ChatView.vue'
// Monaco 编辑器工作台按需异步加载，移出启动包（应用默认进入 chat/home）；配合空闲预热保证切换顺滑。
const CodeWorkbench = defineAsyncComponent(() => import('./components/code/CodeWorkbench.vue'))
import WebBrowserView from './components/browser/WebBrowserView.vue'
import ScheduledTasksView from './components/scheduled/ScheduledTasksView.vue'
import SettingsView from './components/settings/SettingsView.vue'
import LogoutConfirmModal from './components/common/LogoutConfirmModal.vue'
import PendingConfirmBanner from './components/common/PendingConfirmBanner.vue'
import CommandPalette from './components/common/CommandPalette.vue'
import AppDialog from './components/common/AppDialog.vue'
import TerminalDock from './components/terminal/TerminalDock.vue'
import RightContextPanel from './components/layout/RightContextPanel.vue'
import ImageAttachmentViewer from './components/home/ImageAttachmentViewer.vue'
import UpdateNotice from './components/common/UpdateNotice.vue'
import { useUiStore } from './stores/ui.store'
import { useSettingsStore } from './stores/settings.store'
import { useThemeStore } from './stores/theme.store'
import { DEFAULT_THEME_SETTINGS } from '../shared/types/theme.js'
import type { AppMenuCommand } from '../shared/types/menu.js'
import { applyTheme } from './utils/theme-apply.js'
import { useSessionStore } from './stores/session.store.js'
import { useProjectStore } from './stores/project.store'
import { useAuthStore } from './stores/auth.store'
import { useCodeAgentStore } from './stores/code-agent.store'
import { useBrowserStore } from './stores/browser.store.js'
import { useTerminalStore } from './stores/terminal.store'
import { useScheduledTaskStore } from './stores/scheduled-task.store'
import { useUpdaterStore } from './stores/updater.store'
import { useAgentRuntimeStore } from './stores/agent-runtime.store'
import { conversation } from './services/conversation-client.js'
import {
  clearLegacyConversationStorage,
  readLegacyConversationData
} from './services/legacy-import.js'
import { handleGlobalShortcut, runAppMenuCommand } from './utils/global-shortcuts.js'

const ui = useUiStore()
const settings = useSettingsStore()
const theme = useThemeStore()
const sessions = useSessionStore()
const projects = useProjectStore()
const auth = useAuthStore()
const codeAgent = useCodeAgentStore()
const browser = useBrowserStore()
const terminal = useTerminalStore()
const scheduledTasks = useScheduledTaskStore()
const updater = useUpdaterStore()
const agentRuntime = useAgentRuntimeStore()
const sidebarResizing = ref(false)
let sidebarPointerId: number | null = null
let removeMenuCommandListener: (() => void) | null = null
let removeChatPromptListener: (() => void) | null = null

async function bootstrapApp(): Promise<void> {
  const legacy = readLegacyConversationData()
  if (legacy) {
    await conversation.importLegacy(legacy)
    clearLegacyConversationStorage()
  }

  await Promise.all([sessions.load(), projects.load(), settings.load(), codeAgent.load()])

  // 已安排任务：注册主进程“到点触发”监听并加载列表（侧边栏“到期”徽标依赖此处的全局加载）。
  scheduledTasks.startFiredListener()
  void scheduledTasks.load()

  // 自动更新：订阅主进程更新状态，使「有可用更新 / 已下载可重启」横幅能出现。
  void updater.init()
  agentRuntime.start()

  // 空闲预热 Monaco 运行时，使首次打开编辑器接近即时。
  // 用动态 import 触发，避免把 monaco 模块图静态拉进启动包（不阻塞启动、幂等）。
  const warmMonaco = (): void => {
    void import('./services/monaco.service.js').then((m) => m.prefetchMonacoRuntime()).catch(() => undefined)
  }
  const idle = (globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (typeof idle === 'function') idle(warmMonaco, { timeout: 3000 })
  else setTimeout(warmMonaco, 500)

  if (ui.currentView === 'code' && !settings.professionalMode) {
    ui.currentView = sessions.activeSession?.messages.length ? 'chat' : 'home'
    return
  }

  if (ui.currentView !== 'code' && sessions.activeSession?.messages.length) {
    ui.currentView = 'chat'
  }
}

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) void bootstrapApp()
  },
  { immediate: true }
)

function handleKeydown(e: KeyboardEvent): void {
  if (!auth.isLoggedIn) return
  void handleGlobalShortcut(e)
}

function startSidebarResize(event: PointerEvent): void {
  if (ui.sidebarCollapsed) return
  event.preventDefault()
  sidebarPointerId = event.pointerId
  sidebarResizing.value = true
  ui.setSidebarWidth(event.clientX)
  window.addEventListener('pointermove', resizeSidebar)
  window.addEventListener('pointerup', stopSidebarResize)
  window.addEventListener('pointercancel', stopSidebarResize)
}

function resizeSidebar(event: PointerEvent): void {
  if (!sidebarResizing.value) return
  if (sidebarPointerId !== null && event.pointerId !== sidebarPointerId) return
  ui.setSidebarWidth(event.clientX)
}

function stopSidebarResize(): void {
  sidebarPointerId = null
  sidebarResizing.value = false
  window.removeEventListener('pointermove', resizeSidebar)
  window.removeEventListener('pointerup', stopSidebarResize)
  window.removeEventListener('pointercancel', stopSidebarResize)
}

onMounted(() => {
  applyTheme(DEFAULT_THEME_SETTINGS)
  theme.bindSystemListeners()
  void theme.load()
  auth.load()
  removeMenuCommandListener = window.luckyAI.app.onMenuCommand((command: AppMenuCommand) => {
    if (!auth.isLoggedIn && command !== 'open-settings') return
    void runAppMenuCommand(command)
  })
  // 浏览器右键「AI 总结此页 / AI 解释选中」→ 留在浏览器，并交给浏览器 AI 面板执行。
  removeChatPromptListener = window.luckyAI.app.onChatPrompt((prompt: string) => {
    if (!auth.isLoggedIn) return
    browser.requestAiPrompt(prompt, true)
  })
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  removeMenuCommandListener?.()
  removeMenuCommandListener = null
  removeChatPromptListener?.()
  removeChatPromptListener = null
  scheduledTasks.stopFiredListener()
  updater.dispose()
  agentRuntime.stop()
  stopSidebarResize()
})
</script>

<template>
  <div v-if="!auth.loaded" class="boot-screen" />

  <LoginView v-else-if="!auth.isLoggedIn" />

  <template v-else>
    <SettingsView v-if="settings.showSettings" />

    <div v-else class="app-root">
      <!-- 全屏浏览器视图：隐藏标题栏（无红绿灯可放），让浏览器 tab 栏成为最顶行 -->
      <AppTitleBar v-if="!(ui.isFullscreen && ui.currentView === 'browser')" />
      <div class="app-body">
        <AppSidebar
          v-show="!ui.sidebarCollapsed"
          :style="{ width: `${ui.sidebarWidth}px` }"
        />
        <div
          v-show="!ui.sidebarCollapsed"
          class="sidebar-resizer no-drag"
          :class="{ resizing: sidebarResizing }"
          role="separator"
          aria-orientation="vertical"
          :aria-valuemin="220"
          :aria-valuenow="ui.sidebarWidth"
          tabindex="0"
          @pointerdown="startSidebarResize"
        />
        <main class="main-pane">
          <div class="main-row">
            <div class="main-content">
              <HomeView v-if="ui.currentView === 'home'" />
              <ChatView v-else-if="ui.currentView === 'chat'" />
              <CodeWorkbench v-else-if="ui.currentView === 'code'" />
              <KeepAlive v-else-if="ui.currentView === 'browser'">
                <WebBrowserView />
              </KeepAlive>
              <ScheduledTasksView v-else-if="ui.currentView === 'scheduled'" />
              <ChatView v-else />
            </div>
            <RightContextPanel v-if="ui.rightPanelVisible && ui.currentView !== 'code'" />
            <TerminalDock
              v-if="terminal.visible && ui.currentView !== 'code' && settings.general.defaultTerminalLocation === 'right'"
              location="right"
            />
          </div>
          <TerminalDock
            v-if="terminal.visible && ui.currentView !== 'code' && settings.general.defaultTerminalLocation === 'bottom'"
            location="bottom"
          />
        </main>
      </div>
    </div>

    <LogoutConfirmModal />
    <PendingConfirmBanner />
    <CommandPalette />
    <AppDialog />
    <ImageAttachmentViewer />
    <UpdateNotice />
  </template>
</template>

<style scoped>
.boot-screen {
  @apply h-screen w-screen bg-codex-bg;
}
.app-root {
  @apply flex flex-col h-screen w-screen overflow-hidden bg-codex-bg text-codex-text;
}
.app-body {
  @apply flex flex-1 min-h-0 min-w-0;
}
.sidebar-resizer {
  position: relative;
  z-index: 12;
  width: 5px;
  margin-left: -3px;
  flex: 0 0 5px;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
}
.sidebar-resizer::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--codex-border, #dcdcdc);
  content: "";
}
.sidebar-resizer:hover::before,
.sidebar-resizer.resizing::before,
.sidebar-resizer:focus-visible::before {
  left: 1px;
  width: 3px;
  background: #b9b9b9;
}
.sidebar-resizer.resizing {
  cursor: col-resize;
}
:global(body:has(.sidebar-resizer.resizing)) {
  cursor: col-resize;
  user-select: none;
}
.main-pane {
  @apply flex-1 flex flex-col min-w-0 min-h-0;
}
.main-row {
  @apply flex flex-1 min-h-0 min-w-0;
}
.main-content {
  @apply flex-1 flex flex-col min-h-0 min-w-0;
}
</style>
