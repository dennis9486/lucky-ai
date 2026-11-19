<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { MoreHorizontal, Columns2, PanelRight } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'

const { t } = useI18n()
const ui = useUiStore()

defineProps<{
  title: string
}>()

async function createWindow(): Promise<void> {
  await unwrap(ipc.app.createWindow())
}
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <h2 class="chat-title">{{ title }}</h2>
      <button type="button" class="icon-btn" :title="t('titlebar.more')">
        <MoreHorizontal :size="18" />
      </button>
    </div>

    <div class="header-right">
      <button type="button" class="icon-btn" :title="t('titlebar.splitView')" @click="createWindow">
        <Columns2 :size="18" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': ui.rightPanelVisible }"
        :title="t('titlebar.panel')"
        @click="ui.toggleRightPanel()"
      >
        <PanelRight :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  @apply shrink-0 flex items-center justify-between px-4 h-[44px] border-b border-codex-border;
}
.header-left, .header-right {
  @apply flex items-center gap-1 min-w-0;
}
.chat-title {
  @apply text-[15px] font-medium text-codex-text truncate max-w-[280px];
}
.icon-btn {
  @apply p-1.5 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors shrink-0;
}
.icon-btn.is-active {
  @apply bg-codex-hover text-codex-text;
}
</style>
