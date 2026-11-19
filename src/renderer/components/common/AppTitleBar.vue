<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MoreHorizontal, PanelBottom, PanelRight, Settings, Sidebar, SquareSplitHorizontal } from 'lucide-vue-next'
import WindowChromeBar from './WindowChromeBar.vue'
import { useUiStore } from '../../stores/ui.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useTerminalStore } from '../../stores/terminal.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'

const { t } = useI18n()
const ui = useUiStore()
const sessions = useSessionStore()
const terminal = useTerminalStore()
const projects = useProjectStore()
const settings = useSettingsStore()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const sessionTitle = computed(
  () => sessions.activeSession?.title ?? t('titlebar.defaultSession')
)

async function toggleTerminal(): Promise<void> {
  const ready = await projects.ensureWorkspace()
  if (!ready) return
  await terminal.toggle()
}

function togglePanel(): void {
  if (ui.currentView === 'code') {
    ui.toggleCodeAgentPanel()
    return
  }
  ui.toggleRightPanel()
}

const panelButtonActive = computed(() =>
  ui.currentView === 'code' ? ui.codeAgentVisible : ui.rightPanelVisible
)

const panelButtonTitle = computed(() =>
  ui.currentView === 'code' ? t('titlebar.codeAgentPanel') : t('titlebar.panel')
)

const showBottomPanelButton = computed(() =>
  ui.currentView === 'code' || settings.general.showBottomPanel
)

function toggleMoreMenu(): void {
  menuOpen.value = !menuOpen.value
}

function openSettings(): void {
  settings.showSettings = true
  menuOpen.value = false
}

async function createWindow(): Promise<void> {
  await unwrap(ipc.app.createWindow())
  menuOpen.value = false
}

function toggleSidebar(): void {
  ui.sidebarCollapsed = !ui.sidebarCollapsed
  menuOpen.value = false
}

function onDocClick(event: MouseEvent): void {
  if (!menuRef.value?.contains(event.target as Node)) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="app-titlebar">
    <div
      v-if="!ui.sidebarCollapsed"
      class="titlebar-sidebar-zone"
      :class="{ fullscreen: ui.isFullscreen }"
      :style="{ width: `${ui.sidebarWidth}px` }"
    >
      <WindowChromeBar class="no-drag" />
      <div class="titlebar-drag drag-region" />
    </div>

    <div class="titlebar-main-zone" :class="{ 'is-collapsed': ui.sidebarCollapsed, fullscreen: ui.isFullscreen }">
      <WindowChromeBar v-if="ui.sidebarCollapsed" class="no-drag shrink-0" />

      <template v-if="ui.currentView === 'chat'">
        <div class="chat-title-group no-drag">
          <h2 class="chat-title">{{ sessionTitle }}</h2>
          <div ref="menuRef" class="more-wrap">
            <button type="button" class="icon-btn" :class="{ 'is-active': menuOpen }" :title="t('titlebar.more')" @click.stop="toggleMoreMenu">
              <MoreHorizontal :size="17" :stroke-width="1.75" />
            </button>
            <div v-if="menuOpen" class="more-menu">
              <button type="button" @click="openSettings">
                <Settings :size="14" />
                <span>{{ t('titlebar.settings') }}</span>
              </button>
              <button type="button" @click="createWindow">
                <SquareSplitHorizontal :size="14" />
                <span>{{ t('titlebar.newWindow') }}</span>
              </button>
              <button type="button" @click="toggleSidebar">
                <Sidebar :size="14" />
                <span>{{ ui.sidebarCollapsed ? t('titlebar.showSidebar') : t('titlebar.hideSidebar') }}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="titlebar-drag drag-region" />
        <div class="chat-actions no-drag">
          <button
            type="button"
            class="icon-btn"
            :title="t('titlebar.splitView')"
            @click="createWindow"
          >
            <SquareSplitHorizontal :size="17" :stroke-width="1.75" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-active': panelButtonActive }"
            :title="panelButtonTitle"
            @click="togglePanel"
          >
            <PanelRight :size="17" :stroke-width="1.75" />
          </button>
          <button
            v-if="showBottomPanelButton"
            type="button"
            class="icon-btn"
            :class="{ 'is-active': terminal.visible }"
            :title="t('titlebar.toggleTerminal')"
            @click="toggleTerminal"
          >
            <PanelBottom :size="17" :stroke-width="1.75" />
          </button>
        </div>
      </template>

      <template v-else>
        <div class="titlebar-drag drag-region flex-1" />
        <!-- 浏览器视图自带完整浏览器 chrome，标题栏不再显示面板/终端按钮，保持极简 -->
        <div v-if="ui.currentView !== 'browser'" class="home-actions no-drag">
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-active': panelButtonActive }"
            :title="panelButtonTitle"
            @click="togglePanel"
          >
            <PanelRight :size="17" :stroke-width="1.75" />
          </button>
          <button
            v-if="showBottomPanelButton"
            type="button"
            class="icon-btn"
            :class="{ 'is-active': terminal.visible }"
            :title="t('titlebar.toggleTerminal')"
            @click="toggleTerminal"
          >
            <PanelBottom :size="17" :stroke-width="1.75" />
          </button>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  @apply flex h-[38px] shrink-0 border-b border-codex-border bg-codex-bg;
}
.titlebar-sidebar-zone {
  @apply min-w-[220px] shrink-0 flex items-center pl-[72px] pr-2
         bg-codex-sidebar border-r border-codex-border;
}
/* 全屏时 macOS 隐藏红绿灯，去掉为其预留的 72px 空白 */
.titlebar-sidebar-zone.fullscreen {
  @apply pl-3;
}
.titlebar-main-zone {
  @apply flex-1 flex items-center min-w-0 px-3 gap-1;
}
.titlebar-main-zone.is-collapsed {
  @apply pl-[72px];
}
.titlebar-main-zone.is-collapsed.fullscreen {
  @apply pl-3;
}
.titlebar-drag {
  @apply flex-1 h-full min-w-0;
}
.chat-title-group {
  @apply flex items-center gap-0.5 min-w-0 shrink-0;
}
.more-wrap {
  @apply relative;
}
.chat-title {
  @apply text-[15px] font-medium text-codex-text truncate max-w-[240px];
}
.chat-actions,
.home-actions {
  @apply flex items-center gap-0.5 shrink-0;
}
.icon-btn {
  @apply p-1.5 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.icon-btn.is-active {
  @apply bg-codex-hover text-codex-text;
}
.more-menu {
  @apply absolute left-0 top-full z-50 mt-1 w-[188px] rounded-xl border border-codex-border
         bg-codex-bg p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.16)];
}
.more-menu button {
  @apply flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]
         text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text;
}
.drag-region { -webkit-app-region: drag; }
.no-drag { -webkit-app-region: no-drag; }
</style>
