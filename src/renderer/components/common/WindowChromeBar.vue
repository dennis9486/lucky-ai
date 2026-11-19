<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'

const { t } = useI18n()
const ui = useUiStore()
</script>

<template>
  <div class="window-chrome">
    <button
      type="button"
      class="chrome-btn"
      :title="t('chrome.toggleSidebar')"
      @click="ui.sidebarCollapsed = !ui.sidebarCollapsed"
    >
      <PanelLeft :size="15" :stroke-width="1.75" />
    </button>
    <!-- 浏览器视图自带可用的前进/后退，隐藏标题栏这对占位箭头，避免重复/混淆 -->
    <template v-if="ui.currentView !== 'browser'">
      <button type="button" class="chrome-btn" :title="t('chrome.back')" disabled>
        <ArrowLeft :size="15" :stroke-width="1.75" />
      </button>
      <button type="button" class="chrome-btn" :title="t('chrome.forward')" disabled>
        <ArrowRight :size="15" :stroke-width="1.75" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.window-chrome {
  @apply flex items-center gap-0.5 shrink-0;
}
.chrome-btn {
  @apply flex items-center justify-center w-7 h-7 rounded-md
         text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text
         disabled:opacity-[0.32] disabled:hover:bg-transparent
         transition-colors;
}
</style>
